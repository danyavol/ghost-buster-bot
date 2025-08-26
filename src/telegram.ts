export type TelegramUpdate = {
  update_id: number;
  message?: any;
  chat_member?: any;
  my_chat_member?: any;
  edited_message?: any;
  callback_query?: any;
  poll?: any;
  poll_answer?: any;
  message_reaction?: any;
};

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

export class TelegramApiClient {
  private readonly apiUrl: string;

  constructor(private readonly token: string) {
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(chatId: number | string, text: string, options?: Record<string, unknown>): Promise<any> {
    return this.call("sendMessage", { chat_id: chatId, text, ...options });
  }

  async getChatMember(chatId: number | string, userId: number): Promise<any> {
    return this.call("getChatMember", { chat_id: chatId, user_id: userId });
  }

  async banChatMember(chatId: number | string, userId: number, untilDate?: number): Promise<any> {
    return this.call("banChatMember", { chat_id: chatId, user_id: userId, until_date: untilDate });
  }

  async setWebhook(url: string, secretToken: string): Promise<any> {
    return this.call("setWebhook", { url, secret_token: secretToken, drop_pending_updates: false });
  }

  private async call(method: string, payload: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${this.apiUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json<any>();
    if (!data.ok) {
      throw new Error(`Telegram API error for ${method}: ${JSON.stringify(data)}`);
    }
    return data.result;
  }
}

export function htmlMention(userId: number, displayName: string): string {
  const safe = displayName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<a href="tg://user?id=${userId}">${safe}</a>`;
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

