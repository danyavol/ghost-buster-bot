import { TelegramApiClient, TelegramUpdate, htmlMention } from "./telegram";

interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

type ChatRole = "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("ok", { status: 200 });
    }
    if (request.method === "POST" && url.pathname === "/webhook") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!secret || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = (await request.json()) as TelegramUpdate;
      ctx.waitUntil(handleUpdate(env, update));
      return new Response("ok", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailySweep(env));
  },
};

async function handleUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  try {
    if (update.message) {
      const msg = update.message;
      if (!msg.chat || !msg.from) return;
      // Ignore non-group chats
      if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") return;
      await ensureChat(env, msg.chat);

      // Commands (admin-only)
      if (typeof msg.text === "string" && msg.text.startsWith("/")) {
        const tg = new TelegramApiClient(env.TELEGRAM_BOT_TOKEN);
        const text: string = msg.text.trim();
        const [cmdRaw, ...args] = text.split(/\s+/);
        const cmd = cmdRaw.split("@")[0];
        if (cmd === "/set-window") {
          await handleSetWindow(env, tg, msg.chat.id, msg.from.id, args);
        } else if (cmd === "/preview") {
          await handlePreview(env, tg, msg.chat.id, msg.from.id);
        } else if (cmd === "/status") {
          await handleStatus(env, tg, msg.chat.id);
        } else if (cmd === "/help" || cmd === "/start") {
          await sendHelp(tg, msg.chat.id);
        }
      }

      // Any message counts as activity
      await upsertMemberActivity(env, msg.chat.id, msg.from, "message");
      return;
    }
    if ((update as any).message_reaction) {
      const r = (update as any).message_reaction;
      if (!r.chat || !r.user) return;
      if (r.chat.type !== "group" && r.chat.type !== "supergroup") return;
      await ensureChat(env, r.chat);
      await upsertReactionActivity(env, r.chat.id, r.user);
      return;
    }
    if (update.chat_member) {
      const cm = update.chat_member;
      if (cm.chat?.type !== "group" && cm.chat?.type !== "supergroup") return;
      await ensureChat(env, cm.chat);
      await upsertMemberRole(env, cm.chat.id, cm.new_chat_member.user, cm.new_chat_member.status);
      return;
    }
    if (update.my_chat_member) {
      const cm = update.my_chat_member;
      if (cm.chat?.type !== "group" && cm.chat?.type !== "supergroup") return;
      await ensureChat(env, cm.chat);
      return;
    }
  } catch (e) {
    console.error("handleUpdate error", e);
  }
}

async function ensureChat(env: Env, chat: any): Promise<void> {
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO chats (chat_id, title, activity_window_days, grace_days, created_at, updated_at)
     VALUES (?1, ?2, 60, 7, ?3, ?3)
     ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title, updated_at = ?3`
  )
    .bind(chat.id, chat.title ?? chat.username ?? String(chat.id), nowIso)
    .run();
}

async function upsertMemberActivity(env: Env, chatId: number, user: any, kind: "message"): Promise<void> {
  if (!user || user.is_bot) return;
  const nowIso = new Date().toISOString();
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id);
  const username = user.username ?? null;
  await env.DB.prepare(
    `INSERT INTO chat_members (chat_id, user_id, display_name, username, role, joined_at, last_message_at, last_activity_at, warned_at, excluded)
     VALUES (?1, ?2, ?3, ?5, 'member', ?4, ?4, ?4, NULL, 0)
     ON CONFLICT(chat_id, user_id) DO UPDATE SET
       display_name = excluded.display_name,
       username = excluded.username,
       last_message_at = ?4,
       last_activity_at = ?4,
       role = CASE WHEN chat_members.role IN ('left','kicked') THEN 'member' ELSE chat_members.role END,
       warned_at = NULL`
  )
    .bind(chatId, user.id, name, nowIso, username)
    .run();
}

async function upsertReactionActivity(env: Env, chatId: number, user: any): Promise<void> {
  if (!user || user.is_bot) return;
  const nowIso = new Date().toISOString();
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id);
  const username = user.username ?? null;
  await env.DB.prepare(
    `INSERT INTO chat_members (chat_id, user_id, display_name, username, role, joined_at, last_reaction_at, last_activity_at, warned_at, excluded)
     VALUES (?1, ?2, ?3, ?5, 'member', ?4, ?4, ?4, NULL, 0)
     ON CONFLICT(chat_id, user_id) DO UPDATE SET
       display_name = excluded.display_name,
       username = excluded.username,
       last_reaction_at = ?4,
       last_activity_at = CASE
         WHEN chat_members.last_activity_at IS NULL OR ?4 > chat_members.last_activity_at THEN ?4
         ELSE chat_members.last_activity_at
       END,
       role = CASE WHEN chat_members.role IN ('left','kicked') THEN 'member' ELSE chat_members.role END,
       warned_at = NULL`
  )
    .bind(chatId, user.id, name, nowIso, username)
    .run();
}

async function upsertMemberRole(env: Env, chatId: number, user: any, status: ChatRole): Promise<void> {
  const nowIso = new Date().toISOString();
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id);
  const username = user.username ?? null;
  await env.DB.prepare(
    `INSERT INTO chat_members (chat_id, user_id, display_name, username, role, joined_at, excluded)
     VALUES (?1, ?2, ?3, ?6, ?4, ?5, 0)
     ON CONFLICT(chat_id, user_id) DO UPDATE SET display_name = excluded.display_name, username = excluded.username, role = ?4`
  )
    .bind(chatId, user.id, name, status, nowIso, username)
    .run();
}

async function runDailySweep(env: Env): Promise<void> {
  const tg = new TelegramApiClient(env.TELEGRAM_BOT_TOKEN);
  const chats = await env.DB.prepare(`SELECT chat_id, activity_window_days, grace_days FROM chats`).all<{ chat_id: number; activity_window_days: number; grace_days: number }>();
  const now = new Date();

  for (const row of chats.results ?? []) {
    const chatId = row.chat_id;
    const windowDays = row.activity_window_days ?? 60;
    const graceDays = row.grace_days ?? 7;
    const warnAtDays = windowDays - 1;

    // Members to warn today: inactive for (windowDays - 1) days, not warned yet
    const toWarn = await env.DB.prepare(
      `SELECT user_id, display_name FROM chat_members
       WHERE chat_id = ?1 AND excluded = 0 AND role = 'member'
         AND (joined_at IS NULL OR datetime(joined_at) <= datetime(?2, '-' || ?4 || ' days'))
         AND (last_activity_at IS NULL OR datetime(last_activity_at) <= datetime(?2, '-' || ?3 || ' days'))
         AND warned_at IS NULL`
    )
      .bind(chatId, now.toISOString(), warnAtDays, graceDays)
      .all<{ user_id: number; display_name: string }>();

    if (toWarn.results && toWarn.results.length > 0) {
      const mentions = toWarn.results.map((r) => htmlMention(r.user_id, r.display_name)).join(", ");
      const text = `Внимание: завтра участники будут исключены из чата за неактивность: ${mentions}. Чтобы остаться, отправьте сообщение сегодня.`;
      try {
        await tg.sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true });
      } catch (e) {
        console.error("send warn message error", e);
      }
      await env.DB.prepare(
        `UPDATE chat_members SET warned_at = ?2 WHERE chat_id = ?1 AND user_id IN (${toWarn.results.map(() => "?").join(", ")})`
      )
        .bind(chatId, now.toISOString(), ...(toWarn.results.map((r) => r.user_id) as unknown as any[]))
        .run();
    }

    // Members to kick today: inactive for windowDays and have been warned previously
    const toKick = await env.DB.prepare(
      `SELECT user_id, display_name FROM chat_members
       WHERE chat_id = ?1 AND excluded = 0 AND role = 'member'
         AND (joined_at IS NULL OR datetime(joined_at) <= datetime(?2, '-' || ?3 || ' days'))
         AND (last_activity_at IS NULL OR datetime(last_activity_at) <= datetime(?2, '-' || ?4 || ' days'))
         AND warned_at IS NOT NULL`
    )
      .bind(chatId, now.toISOString(), graceDays, windowDays)
      .all<{ user_id: number; display_name: string }>();

    for (const m of toKick.results ?? []) {
      try {
        await tg.banChatMember(chatId, m.user_id);
        await env.DB.prepare(`UPDATE chat_members SET role = 'kicked' WHERE chat_id = ?1 AND user_id = ?2`).bind(chatId, m.user_id).run();
      } catch (e) {
        console.error("kick error", e);
      }
    }
  }
}

async function assertAdmin(env: Env, tg: TelegramApiClient, chatId: number, userId: number): Promise<boolean> {
  try {
    const member = await tg.getChatMember(chatId, userId);
    const status = member?.status as ChatRole | undefined;
    return status === "creator" || status === "administrator";
  } catch {
    return false;
  }
}

async function handleStatus(env: Env, tg: TelegramApiClient, chatId: number): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const botIdStr = token.split(":")[0];
  const botId = Number(botIdStr);
  try {
    const m = await tg.getChatMember(chatId, botId);
    const status = m?.status as ChatRole | undefined;
    const canRestrict = Boolean(m?.can_restrict_members) || status === "creator";
    const lines = [
      `Статус бота: ${status ?? "unknown"}`,
      `Право удалять (can_restrict_members): ${canRestrict ? "да" : "нет"}`,
    ];
    await tg.sendMessage(chatId, lines.join("\n"));
  } catch (e) {
    await tg.sendMessage(chatId, `Не удалось получить статус бота. Убедитесь, что бот в группе.`);
  }
}

async function handleSetWindow(env: Env, tg: TelegramApiClient, chatId: number, fromUserId: number, args: string[]): Promise<void> {
  const isAdmin = await assertAdmin(env, tg, chatId, fromUserId);
  if (!isAdmin) return;
  const value = Number(args[0]);
  if (!Number.isFinite(value) || value < 7 || value > 365) {
    await tg.sendMessage(chatId, `Укажите число дней 7-365. Пример: /set-window 60`);
    return;
  }
  await env.DB.prepare(`UPDATE chats SET activity_window_days = ?2, updated_at = ?3 WHERE chat_id = ?1`)
    .bind(chatId, value, new Date().toISOString())
    .run();
  await tg.sendMessage(chatId, `Ок. Окно активности = ${value} д.`);
}

async function handlePreview(env: Env, tg: TelegramApiClient, chatId: number, fromUserId: number): Promise<void> {
  const isAdmin = await assertAdmin(env, tg, chatId, fromUserId);
  if (!isAdmin) return;
  const row = await env.DB.prepare(`SELECT activity_window_days, grace_days FROM chats WHERE chat_id = ?1`).bind(chatId).first<{ activity_window_days: number; grace_days: number }>();
  const windowDays = row?.activity_window_days ?? 60;
  const graceDays = row?.grace_days ?? 7;
  const nowIso = new Date().toISOString();
  const res = await env.DB.prepare(
    `SELECT user_id, display_name FROM chat_members
     WHERE chat_id = ?1 AND excluded = 0 AND role = 'member'
       AND (joined_at IS NULL OR datetime(joined_at) <= datetime(?2, '-' || ?3 || ' days'))
       AND (last_activity_at IS NULL OR datetime(last_activity_at) <= datetime(?2, '-' || ?4 || ' days'))
     ORDER BY last_activity_at NULLS FIRST
     LIMIT 50`
  )
    .bind(chatId, nowIso, graceDays, windowDays)
    .all<{ user_id: number; display_name: string }>();

  if (!res.results || res.results.length === 0) {
    await tg.sendMessage(chatId, `Кандидатов на удаление нет.`);
    return;
  }
  const mentions = res.results.map((r) => htmlMention(r.user_id, r.display_name)).join(", ");
  await tg.sendMessage(chatId, `Кандидаты на удаление: ${mentions}`, { parse_mode: "HTML", disable_web_page_preview: true });
}

async function sendHelp(tg: TelegramApiClient, chatId: number): Promise<void> {
  const text = [
    "Я помогаю поддерживать активность в группе:",
    "- Каждый день проверяю активность за окно в N дней (по умолчанию 60)",
    "- За сутки до удаления отправляю предупреждение",
    "- Удаляю только если предупреждение было и активности не было",
    "- Активностью считаются сообщения и реакции",
    "",
    "Команды (для админов):",
    "- /set-window N — установить окно активности в днях (7–365)",
    "- /preview — показать кандидатов на удаление (до 50)",
    "- /status — проверить права бота (нужен can_restrict_members)",
    "",
    "Примечание: новички имеют отсрочку (grace) 7 дней по умолчанию.",
  ].join("\n");
  await tg.sendMessage(chatId, text);
}

