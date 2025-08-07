import TelegramBot from "node-telegram-bot-api";
import { GoogleGenAI } from "@google/genai";

const tgToken = "8384358019:AAGvmZP4NqQ7dgw6UokabwxEhTQ39Khs5Fw";
const geminiApiKey = "AIzaSyBN6tQRclDhbPjh3LMoolhmQMUrETVsHqk";

const LOG_CHAT_ID = -1002804779527;

const bot = new TelegramBot(tgToken, { polling: true });
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

// 🧠 Память для каждого чата
const chatHistory = new Map();

function cleanResponse(text) {
  return text
    .replace(/\$\$([^$]+)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\*\*+/g, "")
    .trim();
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userText = msg.text?.trim();

  if (!userText) return;

  if (userText.toLowerCase() === "/start") {
    await bot.sendMessage(chatId, "Создатель — Влад, пользуйтесь попуски");
    return;
  }

  const userFirstName = msg.from?.first_name || "Неизвестно";
  const userLastName = msg.from?.last_name || "";
  const username = msg.from?.username ? `@${msg.from.username}` : "не указан";
  const phone = msg.contact?.phone_number || "не указан";

  console.log(`📩 Пользователь: ${userText}`);

  // 🧠 Получаем или создаем историю чата
  const history = chatHistory.get(chatId) || [];

  // ➕ Добавляем сообщение пользователя
  history.push({ role: "user", parts: [{ text: userText }] });

  // ✂️ Ограничим до 10 последних сообщений
  while (history.length > 10) {
    history.shift(); // Удаляем самое старое
  }

  const thinkingMsg = await bot.sendMessage(chatId, "🤖 Бот думает...");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: history,
    });

    const cleaned = cleanResponse(response.text);

    // ➕ Добавляем ответ бота в историю
    history.push({ role: "model", parts: [{ text: cleaned }] });

    // ✂️ Ограничим снова до 10 после добавления ответа
    while (history.length > 10) {
      history.shift();
    }

    // 🧠 Сохраняем обновлённую историю
    chatHistory.set(chatId, history);

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

