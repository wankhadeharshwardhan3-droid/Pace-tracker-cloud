import { requireSession, unauthorized, json, methodNotAllowed } from "./session.js";

const MAX_NAME_LEN = 30;
const MAX_ENTRIES = 5000;

function sanitizeName(name) {
  return String(name || "").trim().slice(0, MAX_NAME_LEN);
}

export async function handleProfile(request, env) {
  const kv = env.PACE_KV;
  const url = new URL(request.url);

  const session = await requireSession(kv, request);
  if (!session) return unauthorized();
  if (session.isAdmin) {
    // Admin sessions aren't tied to a person and have no personal data of
    // their own - they use /api/profiles to see everyone, not this endpoint.
    return unauthorized("Admin sessions can't read or write personal profile data");
  }
  const sessionName = session.name;

  if (request.method === "GET") {
    const name = sanitizeName(url.searchParams.get("name"));
    if (!name) {
      return json(400, { error: "Missing name" });
    }
    if (name.toLowerCase() !== sessionName.toLowerCase()) {
      return unauthorized("You can only view your own profile data");
    }
    const record = (await kv.get(`data:${name}`, { type: "json" })) || { goal: null, entries: [], private: false };
    return json(200, record);
  }

  if (request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json(400, { error: "Invalid JSON" });
    }

    const name = sanitizeName(payload.name);
    if (!name) {
      return json(400, { error: "Missing name" });
    }
    if (name.toLowerCase() !== sessionName.toLowerCase()) {
      return unauthorized("You can only edit your own profile data");
    }

    const incoming = payload.data || {};
    const g = incoming.goal;
    const goal =
      g && typeof g === "object" && g.start && g.end && g.dailyTarget
        ? {
            totalHours: Number(g.totalHours) || 0,
            dailyTarget: Number(g.dailyTarget) || 0,
            start: String(g.start),
            end: String(g.end),
          }
        : null;

    const entries = Array.isArray(incoming.entries)
      ? incoming.entries
          .slice(0, MAX_ENTRIES)
          .map((e) => ({ date: String(e.date || ""), hours: Number(e.hours) || 0 }))
          .filter((e) => e.date)
      : [];

    const isPrivate = Boolean(incoming.private);

    await kv.put(`data:${name}`, JSON.stringify({ goal, entries, private: isPrivate }));

    const list = (await kv.get("list", { type: "json" })) || [];
    if (!list.includes(name)) {
      list.push(name);
      await kv.put("list", JSON.stringify(list));
    }

    return json(200, { ok: true });
  }

  return methodNotAllowed();
}
