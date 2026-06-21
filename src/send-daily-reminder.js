import webpush from "web-push";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// "morning" = 9 AM IST nudge to start studying and open the timer.
// "evening" = 10 PM IST reminder to log the day's hours before bed - this
// is the original single reminder this app used to send.
function buildMessage(kind, name, record) {
  const today = todayStr();
  const entries = (record && record.entries) || [];
  const loggedToday = entries.some((e) => e.date === today && Number(e.hours) > 0);

  if (kind === "morning") {
    if (!record || !record.goal) {
      return { title: "Pace", body: "Set today's study target in Pace and start your first session." };
    }
    return { title: "Pace", body: "Good morning, " + name + " - start your timer and get ahead of today's target." };
  }

  // kind === "evening"
  if (loggedToday) {
    return { title: "Pace", body: "Nice work, " + name + " - today's hours are already logged." };
  }
  if (!record || !record.goal) {
    return { title: "Pace", body: "Set a study target in Pace to start tracking your daily progress." };
  }
  return { title: "Pace", body: "Don't forget to log today's study hours, " + name + "." };
}

export async function sendDailyReminders(env, kind) {
  // Default to "evening" so the existing manual test URL
  // (/api/send-daily-reminder) keeps behaving exactly as it did before.
  const reminderKind = kind === "morning" ? "morning" : "evening";
  const kv = env.PACE_KV;

  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const contact = env.VAPID_CONTACT_EMAIL || "mailto:admin@example.com";

  if (!publicKey || !privateKey) {
    console.error("VAPID keys are not configured, skipping reminder run.");
    return { sent: 0, skipped: 0, failed: 0, total: 0, kind: reminderKind };
  }

  webpush.setVapidDetails(contact, publicKey, privateKey);

  const names = (await kv.get("list", { type: "json" })) || [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const name of names) {
    const accountKey = "account:" + name.toLowerCase();
    const account = await kv.get(accountKey, { type: "json" });
    if (!account || !account.pushSubscription) {
      skipped++;
      continue;
    }

    const record = await kv.get("data:" + name, { type: "json" });
    const message = buildMessage(reminderKind, name, record);

    try {
      await webpush.sendNotification(
        account.pushSubscription,
        JSON.stringify(Object.assign({}, message, { url: "/" }))
      );
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 404 || err.statusCode === 410) {
        delete account.pushSubscription;
        await kv.put(accountKey, JSON.stringify(account));
      } else {
        console.error("Push failed for " + name + ":", err.message || err);
      }
    }
  }

  return { sent, skipped, failed, total: names.length, kind: reminderKind };
}
