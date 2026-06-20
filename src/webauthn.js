import { randomBytes } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { requireSession, unauthorized, json } from "./session.js";

const MAX_NAME_LEN = 30;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days, matches auth.js
const CHALLENGE_TTL_MS = 1000 * 60 * 5; // 5 minutes - plenty for a biometric prompt

// "Relying Party" identity. rpID must match the domain the site is served
// from (no scheme, no port, no trailing slash) - derived from the request
// itself, so it works whether you're on the *.workers.dev domain or a
// custom domain attached later.
function getRpIdAndOrigin(request) {
  const url = new URL(request.url);
  const hostname = url.hostname;
  return { rpID: hostname, origin: url.origin };
}

function sanitizeName(name) {
  return String(name || "").trim().slice(0, MAX_NAME_LEN);
}

function newToken() {
  return randomBytes(32).toString("hex");
}

async function createSession(kv, name) {
  const token = newToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await kv.put(`session:${token}`, JSON.stringify({ name, isAdmin: false, expiresAt }));
  return token;
}

// Credential public keys come back from the library as Uint8Array, but KV
// JSON storage can't hold binary directly - store as base64url.
function bufToB64(buf) {
  return Buffer.from(buf).toString("base64url");
}
function b64ToBuf(str) {
  return new Uint8Array(Buffer.from(str, "base64url"));
}

export async function handleWebauthn(request, env) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const kv = env.PACE_KV;
  const { rpID, origin } = getRpIdAndOrigin(request);

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json(400, { error: "Invalid JSON" });
  }

  const action = payload.action;
  // "reg-options" | "reg-verify" | "auth-options" | "auth-verify" | "remove" | "has-credential"

  // ---- Registration: attaching Face ID / Touch ID / fingerprint to an
  // already-logged-in account. Requires a normal PIN-authenticated session,
  // so this can't be used to silently attach a passkey to someone else's account.
  if (action === "reg-options" || action === "reg-verify" || action === "remove") {
    const session = await requireSession(kv, request);
    if (!session || session.isAdmin || !session.name) {
      return unauthorized("Log in with your PIN first to set this up");
    }
    const name = session.name;
    const accountKey = `account:${name.toLowerCase()}`;
    const account = await kv.get(accountKey, { type: "json" });
    if (!account) return unauthorized();

    if (action === "remove") {
      delete account.webauthnCredential;
      await kv.put(accountKey, JSON.stringify(account));
      return json(200, { ok: true });
    }

    if (action === "reg-options") {
      const options = await generateRegistrationOptions({
        rpName: "Pace",
        rpID,
        userName: name,
        userDisplayName: name,
        attestationType: "none",
        // Don't let someone register the same authenticator twice
        excludeCredentials: account.webauthnCredential
          ? [{ id: account.webauthnCredential.id, transports: account.webauthnCredential.transports }]
          : [],
        authenticatorSelection: {
          // 'platform' = the device's built-in authenticator (Face ID / Touch
          // ID / Windows Hello / Android fingerprint) rather than a separate
          // security key, matching "fingerprint or Face ID" specifically.
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
      });
      await kv.put(
        `webauthn-challenge:${name.toLowerCase()}`,
        JSON.stringify({ challenge: options.challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS })
      );
      return json(200, options);
    }

    // reg-verify
    const challengeRecord = await kv.get(`webauthn-challenge:${name.toLowerCase()}`, { type: "json" });
    if (!challengeRecord || Date.now() > challengeRecord.expiresAt) {
      return json(400, { error: "That registration attempt expired. Try again." });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: payload.response,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
    } catch (e) {
      return json(400, { error: "Could not verify that device. Try again." });
    }
    if (!verification.verified || !verification.registrationInfo) {
      return json(400, { error: "Could not verify that device." });
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    account.webauthnCredential = {
      id: credential.id,
      publicKey: bufToB64(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports || [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      createdAt: Date.now(),
    };
    await kv.put(accountKey, JSON.stringify(account));
    await kv.delete(`webauthn-challenge:${name.toLowerCase()}`).catch(() => {});
    return json(200, { ok: true });
  }

  // ---- Authentication: logging in with Face ID / Touch ID / fingerprint
  // instead of typing the PIN.
  if (action === "auth-options") {
    const name = sanitizeName(payload.name);
    if (!name) return json(400, { error: "Missing name" });
    const accountKey = `account:${name.toLowerCase()}`;
    const account = await kv.get(accountKey, { type: "json" });
    if (!account || !account.webauthnCredential) {
      // Deliberately vague - don't reveal whether the account exists or
      // just lacks a passkey, same caution as a wrong-PIN message.
      return json(404, { error: "No biometric login set up for that name on this device" });
    }
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: [
        { id: account.webauthnCredential.id, transports: account.webauthnCredential.transports },
      ],
      userVerification: "required",
    });
    await kv.put(
      `webauthn-challenge:${name.toLowerCase()}`,
      JSON.stringify({ challenge: options.challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS })
    );
    return json(200, options);
  }

  if (action === "auth-verify") {
    const name = sanitizeName(payload.name);
    if (!name) return json(400, { error: "Missing name" });
    const accountKey = `account:${name.toLowerCase()}`;
    const account = await kv.get(accountKey, { type: "json" });
    if (!account || !account.webauthnCredential) {
      return json(404, { error: "No biometric login set up for that name on this device" });
    }
    const challengeRecord = await kv.get(`webauthn-challenge:${name.toLowerCase()}`, { type: "json" });
    if (!challengeRecord || Date.now() > challengeRecord.expiresAt) {
      return json(400, { error: "That login attempt expired. Try again." });
    }
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: payload.response,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: account.webauthnCredential.id,
          publicKey: b64ToBuf(account.webauthnCredential.publicKey),
          counter: account.webauthnCredential.counter,
          transports: account.webauthnCredential.transports,
        },
      });
    } catch (e) {
      return json(401, { error: "Could not verify - try your PIN instead." });
    }
    if (!verification.verified) {
      return json(401, { error: "Could not verify - try your PIN instead." });
    }
    account.webauthnCredential.counter = verification.authenticationInfo.newCounter;
    await kv.put(accountKey, JSON.stringify(account));
    await kv.delete(`webauthn-challenge:${name.toLowerCase()}`).catch(() => {});

    const token = await createSession(kv, account.name);
    return json(200, { ok: true, name: account.name, token });
  }

  // ---- Lets the gate quietly check "does this name have biometric login set
  // up at all" before showing the option, without needing a session.
  if (action === "has-credential") {
    const name = sanitizeName(payload.name);
    if (!name) return json(400, { error: "Missing name" });
    const account = await kv.get(`account:${name.toLowerCase()}`, { type: "json" });
    return json(200, { hasCredential: Boolean(account && account.webauthnCredential) });
  }

  return json(400, { error: "Unknown action" });
}
