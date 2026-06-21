import { handleAuth } from "./auth.js";
import { handleProfile } from "./profile.js";
import { handleProfiles } from "./profiles.js";
import { handlePush } from "./push.js";
import { handleVapidPublicKey } from "./vapid-public-key.js";
import { handleWebauthn } from "./webauthn.js";
import { handleAdminDeleteAccount } from "./admin.js";
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
    if (path === "/api/admin/delete-account") return handleAdminDeleteAccount(request, env);

    // Manual test trigger for the daily reminders, mirroring the old
    // Netlify behaviour of visiting the function URL directly. Useful for
    // confirming the notification pipeline works without waiting for the
    // scheduled run. Safe to leave in production - it just sends early if
    // you call it. Defaults to the evening "log your hours" reminder;
    // pass ?kind=morning to test the 9 AM "start studying" nudge instead.
    if (path === "/api/send-daily-reminder") {
      const kind = url.searchParams.get("kind") === "morning" ? "morning" : "evening";
      const result = await sendDailyReminders(env, kind);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Anything else falls through to static assets (the public/ directory),
    // handled automatically by the "assets" binding in wrangler.jsonc.
    return env.ASSETS.fetch(request);
  },

  // Fires automatically twice a day, per the cron expressions in
  // wrangler.jsonc -> triggers.crons:
  //   - 03:30 UTC (9:00 AM IST)  -> "morning" nudge to start studying
  //   - 16:30 UTC (10:00 PM IST) -> "evening" reminder to log today's hours
  // No external service or manual visit required - Cloudflare calls this
  // on its own, and controller.cron tells us which one just fired.
  async scheduled(controller, env, ctx) {
    const kind = controller.cron === "30 3 * * *" ? "morning" : "evening";
    const result = await sendDailyReminders(env, kind);
    console.log("Daily reminder run (" + kind + "):", JSON.stringify(result));
  },
};
