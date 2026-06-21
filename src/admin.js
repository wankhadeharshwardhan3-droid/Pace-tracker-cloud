import { timingSafeEqual } from "node:crypto";
import { requireSession, unauthorized, json, methodNotAllowed } from "./session.js";

const MAX_NAME_LEN = 30;

function sanitizeName(name) {
  return String(name || "").trim().slice(0, MAX_NAME_LEN);
}

function passcodeMatches(env, passcode) {
  const expected = env.PACE_ADMIN_PASSCODE || "";
  if (!expected) return false;
  const a = Buffer.from(String(passcode || ""));
  const b = Buffer.from(expected);
  const lengthOk = a.length === b.length;
  return lengthOk && timingSafeEqual(a, b);
}

// Deletes a person's account entirely: their login (account:<name>), their
// study data (data:<name>), their entry in the shared "list" index, and any
// outstanding sessions tied to that name so a stale token can't keep
// working. Requires an active admin session *and* the admin passcode typed
// again in this request - a valid admin session alone isn't enough, since
// the person asked for an extra confirmation step before something this
// destructive and irreversible happens.
export async function handleAdminDeleteAccount(request, env) {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  const kv = env.PACE_KV;

  const session = await requireSession(kv, request);
  if (!session || !session.isAdmin) {
    return unauthorized("Admin session required");
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json(400, { error: "Invalid JSON" });
  }

  if (!passcodeMatches(env, payload.passcode)) {
    return json(401, { error: "Incorrect admin passcode" });
  }

  const name = sanitizeName(payload.name);
  if (!name) {
    return json(400, { error: "Missing name" });
  }

  const accountKey = `account:${name.toLowerCase()}`;
  const account = await kv.get(accountKey, { type: "json" });
  if (!account) {
    return json(404, { error: "No account with that name" });
  }

  await kv.delete(accountKey);
  await kv.delete(`data:${account.name}`);

  const list = (await kv.get("list", { type: "json" })) || [];
  const newList = list.filter((n) => n.toLowerCase() !== name.toLowerCase());
  await kv.put("list", JSON.stringify(newList));

  // Best-effort: also revoke any of this person's currently active login
  // sessions, so a deleted account can't keep working until its token
  // happens to expire on its own. Sessions are keyed by random token (not
  // by name), so this means scanning them - fine for an admin-only,
  // occasional action with a small user base like this app's.
  try {
    let cursor;
    do {
      const page = await kv.list({ prefix: "session:", cursor });
      for (const entry of page.keys) {
        const sessionVal = await kv.get(entry.name, { type: "json" });
        if (sessionVal && sessionVal.name && sessionVal.name.toLowerCase() === name.toLowerCase()) {
          await kv.delete(entry.name);
        }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch (e) {
    // Non-fatal - the account and data are already gone either way.
    console.error("Session cleanup after account deletion failed:", e.message || e);
  }

  return json(200, { ok: true, deleted: account.name });
}
