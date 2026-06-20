import { requireSession, unauthorized, json, methodNotAllowed } from "./session.js";

function daysBetween(a, b) {
  const A = new Date(a + "T00:00:00Z");
  const B = new Date(b + "T00:00:00Z");
  return Math.round((B - A) / 86400000);
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function round1(n) { return Math.round(n * 10) / 10; }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function summarize(name, record, viewerName, isAdmin) {
  const isOwner = name.toLowerCase() === String(viewerName || "").toLowerCase();
  const recordIsPrivate = Boolean(record && record.private);
  // Admin always sees real numbers; everyone else only sees their own or
  // anything that isn't marked private.
  const isPrivate = recordIsPrivate && !isOwner && !isAdmin;

  const goal = record && record.goal;
  const entries = (record && record.entries) || [];
  if (!goal || !goal.start || !goal.end || !goal.dailyTarget) {
    return { name, hasGoal: false, private: recordIsPrivate };
  }
  if (isPrivate) {
    return { name, hasGoal: true, private: true };
  }
  const { totalHours, dailyTarget, start, end } = goal;
  const totalDays = daysBetween(start, end) + 1;
  const today = todayStr();
  const clampedToday = today < start ? start : today > end ? end : today;
  const elapsedDays = clamp(daysBetween(start, clampedToday) + 1, 0, totalDays);
  const loggedTotal = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const expectedSoFar = dailyTarget * elapsedDays;
  const balance = loggedTotal - expectedSoFar;
  const daysRemaining = Math.max(0, daysBetween(today > end ? end : today, end));
  const pct = clamp((loggedTotal / totalHours) * 100, 0, 100);

  return {
    name,
    hasGoal: true,
    // report the record's real private flag (not the bypassed one) so the
    // admin UI can show "hidden from others" even though it can see the numbers
    private: recordIsPrivate,
    dailyTarget,
    totalHours,
    start,
    end,
    loggedTotal: round1(loggedTotal),
    balance: round1(balance),
    daysRemaining,
    pct: round1(pct),
  };
}

export async function handleProfiles(request, env) {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  const kv = env.PACE_KV;

  const session = await requireSession(kv, request);
  if (!session) return unauthorized();

  const names = (await kv.get("list", { type: "json" })) || [];

  const summaries = await Promise.all(
    names.map(async (name) => {
      const record = await kv.get(`data:${name}`, { type: "json" });
      return summarize(name, record, session.name, session.isAdmin);
    })
  );

  return json(200, { summaries, isAdmin: Boolean(session.isAdmin) });
}
