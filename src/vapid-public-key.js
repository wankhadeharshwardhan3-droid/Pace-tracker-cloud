// Serves only the public half of the VAPID key pair - the private key
// (VAPID_PRIVATE_KEY) stays in Worker secrets and is never sent to the
// browser. Used by the frontend to call pushManager.subscribe().
export async function handleVapidPublicKey(request, env) {
  const publicKey = env.VAPID_PUBLIC_KEY || "";
  return new Response(JSON.stringify({ publicKey }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}
