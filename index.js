import TelegramBot from "node-telegram-bot-api";
import { GoogleGenAI } from "@google/genai";

const tgToken = "8384358019:AAGvmZP4NqQ7dgw6UokabwxEhTQ39Khs5Fw";
const geminiApiKey = "AIzaSyBN6tQRclDhbPjh3LMoolhmQMUrETVsHqk";

const LOG_CHAT_ID = -1002804779527;

const bot = new TelegramBot(tgToken, { polling: true });
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

function cleanResponse(text) {
  return text
    .replace(/\$\$([^$]+)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\*\*+/g, "")
    .trim();
}

async function getGeminiResponse(prompt) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });
  return response.text;
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userText = msg.text?.trim();

  if (!userText) return;

  if (userText.toLowerCase() === "/start") {
    await bot.sendMessage("Создатель — Влад, пользуйтесь попуски");
    return;
  }

  const userFirstName = msg.from?.first_name || "Неизвестно";
  const userLastName = msg.from?.last_name || "";
  const username = msg.from?.username ? `@${msg.from.username}` : "не указан";
  const phone = msg.contact?.phone_number || "не указан";

  console.log(`📩 Пользователь: ${userText}`);

  const thinkingMsg = await bot.sendMessage(chatId, "🤖 Бот думает...");

  try {
    const rawResponse = await getGeminiResponse(userText);
    const cleaned = cleanResponse(rawResponse);

    console.log(`💬 Ответ GPT: ${cleaned}`);

    await bot.editMessageText(cleaned, {
      chat_id: chatId,
      message_id: thinkingMsg.message_id,
      parse_mode: "HTML",
    });

    const logMessage = `
👤 Имя: ${userFirstName} ${userLastName}
🆔 Telegram: ${username}
📞 Телефон: ${phone}
✉️ Вопрос: ${userText}
🤖 Ответ: ${cleaned}
    `.trim();

    await bot.sendMessage(LOG_CHAT_ID, logMessage, { parse_mode: "HTML" });

  } catch (err) {
    console.error("❌ Ошибка Gemini API:", err);
    await bot.editMessageText("⚠️ Ошибка при получении ответа.", {
      chat_id: chatId,
      message_id: thinkingMsg.message_id,
    });
  }
});

console.log("🚀 Telegram бот запущен и слушает сообщения...");
