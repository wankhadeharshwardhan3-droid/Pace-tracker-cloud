import { handleAuth } from "./auth.js";
import { handleProfile } from "./profile.js";
import { handleProfiles } from "./profiles.js";
import { handlePush } from "./push.js";
import { handleVapidPublicKey } from "./vapid-public-key.js";
import { handleWebauthn } from "./webauthn.js";
import { sendDailyReminders } from "./send-daily-reminder.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/auth") return handleAuth(request, env);
    if (path === "/api/profile") return handleProfile(request, env);
    if (path === "/api/profiles") return handleProfiles(request, env);
    if (path === "/api/push") return handlePush(request, env);
    if (path === "/api/vapid-public-key") return handleVapidPublicKey(request, env);
    if (path === "/api/webauthn") return handleWebauthn(request, env);

    // Manual test trigger for the daily reminder, mirroring the old
    // Netlify behaviour of visiting the function URL directly. Useful for
    // confirming the notification pipeline works without waiting for the
    // scheduled run. Safe to leave in production - it just sends today's
    // reminders early if you call it.
    if (path === "/api/send-daily-reminder") {
      const result = await sendDailyReminders(env);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Anything else falls through to static assets (the public/ directory),
    // handled automatically by the "assets" binding in wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },

  // Fires automatically once a day at 16:30 UTC (10:00 PM IST), per the
  // cron expression in wrangler.jsonc -> triggers.crons. No external
  // service or manual visit required - Cloudflare calls this on its own.
  async scheduled(controller, env, ctx) {
    const result = await sendDailyReminders(env);
    console.log("Daily reminder run:", JSON.stringify(result));
  },
};
