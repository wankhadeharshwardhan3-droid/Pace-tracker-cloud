// Shared session helper used by the auth, profile, profiles, push, and
// webauthn routes. Unlike Netlify functions, a Worker can share modules
// at runtime with a normal import - no per-function bundling concerns.

export function getBearerToken(request) {
  const header = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

// Returns the full session record { name, isAdmin } for a valid,
// non-expired token, or null. `name` is null for admin sessions (admin
// isn't tied to any one person's account).
export async function requireSession(kv, request) {
  const token = getBearerToken(request);
  if (!token) return null;
  const session = await kv.get(`session:${token}`, { type: "json" });
  if (!session) return null;
  if (!session.expiresAt || Date.now() > session.expiresAt) {
    // expired - best-effort cleanup, don't block on it
    kv.delete(`session:${token}`).catch(() => {});
    return null;
  }
  return session;
}

export function unauthorized(message) {
  return json(401, { error: message || "Not signed in" });
}

export function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function methodNotAllowed() {
  return new Response("Method not allowed", { status: 405 });
}
