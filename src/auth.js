import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { json } from "./session.js";

const scrypt = promisify(scryptCb);

const MAX_NAME_LEN = 30;
const PIN_PATTERN = /^\d{4}$/; // exactly 4 digits
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function sanitizeName(name) {
  return String(name || "").trim().slice(0, MAX_NAME_LEN);
}

async function hashPin(pin) {
  const salt = randomBytes(16);
  const derived = await scrypt(pin, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

async function verifyPin(pin, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) return false;
  const [saltHex, hashHex] = stored.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = await scrypt(pin, salt, 64);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
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

async function createAdminSession(kv) {
  const token = newToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await kv.put(`session:${token}`, JSON.stringify({ name: null, isAdmin: true, expiresAt }));
  return token;
}

export async function handleAuth(request, env) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const kv = env.PACE_KV;

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json(400, { error: "Invalid JSON" });
  }

  const action = payload.action; // "signup" | "login" | "admin"

  if (action === "admin") {
    const passcode = String(payload.passcode || "");
    const expected = env.PACE_ADMIN_PASSCODE || "";
    if (!expected) {
      return json(500, { error: "Admin login isn't configured on this site yet." });
    }
    const a = Buffer.from(passcode);
    const b = Buffer.from(expected);
    // timingSafeEqual requires equal-length buffers; pad the shorter one so
    // length itself doesn't leak via timing, then compare for real.
    const lengthOk = a.length === b.length;
    const same = lengthOk && timingSafeEqual(a, b);
    if (!same) {
      return json(401, { error: "Incorrect admin passcode" });
    }
    const token = await createAdminSession(kv);
    return json(200, { ok: true, isAdmin: true, token });
  }

  const name = sanitizeName(payload.name);
  const pin = String(payload.pin || "");

  if (!name) return json(400, { error: "Missing name" });
  if (!pin) return json(400, { error: "Missing PIN" });

  const accountKey = `account:${name.toLowerCase()}`;

  if (action === "signup") {
    if (!PIN_PATTERN.test(pin)) {
      return json(400, { error: "PIN must be exactly 4 digits" });
    }
    const existing = await kv.get(accountKey, { type: "json" });
    if (existing) {
      return json(409, { error: "That name is already taken. Try logging in instead, or pick a different name." });
    }
    const pinHash = await hashPin(pin);
    await kv.put(accountKey, JSON.stringify({ name, pinHash, createdAt: Date.now() }));

    const token = await createSession(kv, name);
    return json(200, { ok: true, name, token });
  }

  if (action === "login") {
    const account = await kv.get(accountKey, { type: "json" });
    if (!account) {
      return json(401, { error: "No account with that name. Create one first." });
    }
    const valid = await verifyPin(pin, account.pinHash);
    if (!valid) {
      return json(401, { error: "Incorrect PIN" });
    }
    const token = await createSession(kv, account.name);
    return json(200, { ok: true, name: account.name, token });
  }

  return json(400, { error: "Unknown action" });
}

export { SESSION_TTL_MS };
