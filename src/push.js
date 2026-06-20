import { requireSession, unauthorized, json, methodNotAllowed } from "./session.js";

// Push subscriptions are tied to one person's account, the same way
// webauthnCredential is - both live on the `account:<name>` record so a
// signup/login flow never has to touch a second key for the common case.
export async function handlePush(request, env) {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  const kv = env.PACE_KV;

  const session = await requireSession(kv, request);
  if (!session) return unauthorized();
  if (session.isAdmin || !session.name) {
    // Admin isn't tied to a person and has no hours to be reminded about.
    return unauthorized("Admin sessions can't manage push subscriptions");
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json(400, { error: "Invalid JSON" });
  }

  const action = payload.action; // "save" | "remove"
  const accountKey = `account:${session.name.toLowerCase()}`;
  const account = await kv.get(accountKey, { type: "json" });
  if (!account) return unauthorized();

  if (action === "remove") {
    delete account.pushSubscription;
    await kv.put(accountKey, JSON.stringify(account));
    return json(200, { ok: true });
  }

  if (action === "save") {
    const sub = payload.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return json(400, { error: "Invalid push subscription" });
    }
    account.pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      savedAt: Date.now(),
    };
    await kv.put(accountKey, JSON.stringify(account));
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action" });
}
