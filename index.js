import TelegramBot from "node-telegram-bot-api";
import { GoogleGenAI } from "@google/genai";
import fetch from "node-fetch";

const tgToken = "8384358019:AAGvmZP4NqQ7dgw6UokabwxEhTQ39Khs5Fw";
const geminiApiKey = "AIzaSyBN6tQRclDhbPjh3LMoolhmQMUrETVsHqk";

const LOG_CHAT_ID = -1002804779527;

const bot = new TelegramBot(tgToken, { polling: true });
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

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
  const userText = msg.text?.trim() || msg.caption?.trim(); // caption — подпись к фото
  const hasPhoto = !!msg.photo;

  if (!userText && !hasPhoto) return;

  if (userText?.toLowerCase() === "/start") {
    await bot.sendMessage(chatId, "Создатель — Влад, пользуйтесь попуски");
    return;
  }

  const userFirstName = msg.from?.first_name || "Неизвестно";
  const userLastName = msg.from?.last_name || "";
  const username = msg.from?.username ? `@${msg.from.username}` : "не указан";
  const phone = msg.contact?.phone_number || "не указан";

  let history = chatHistory.get(chatId) || [];

  try {
    if (hasPhoto) {
      const photos = msg.photo;
      const fileId = photos[photos.length - 1].file_id;

      const file = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${tgToken}/${file.file_path}`;

      // Загружаем фото в base64 (как раньше)
      const resp = await fetch(fileUrl);
      if (!resp.ok) throw new Error(`Ошибка загрузки файла: ${resp.status}`);
      const buffer = await resp.arrayBuffer();
      const base64Image = Buffer.from(buffer).toString("base64");

      const ext = file.file_path.split(".").pop().toLowerCase();
      let mimeType = "image/jpeg";
      if (ext === "png") mimeType = "image/png";
      else if (ext === "webp") mimeType = "image/webp";

      // Если есть подпись — используем её как вопрос к изображению, если нет — просто описываем
      const promptText = msg.caption?.trim() || "Опиши, что изображено на этой фотографии.";

      const contents = [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Image,
              },
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              text: promptText,
            },
          ],
        },
      ];

      const thinkingMsg = await bot.sendMessage(chatId, "🤖 Бот думает...");

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: { thinkingConfig: { thinkingBudget: 0 } },
      });

      const description = cleanResponse(response.text);

      history.push({ role: "user", parts: [{ text: `Фото + запрос: ${promptText}` }] });
      history.push({ role: "model", parts: [{ text: description }] });

      if (history.length > 10) history.splice(0, history.length - 10);
      chatHistory.set(chatId, history);

      await bot.editMessageText(description, {
        chat_id: chatId,
        message_id: thinkingMsg.message_id,
        parse_mode: "HTML",
      });

      const logMessage = `
👤 Имя: ${userFirstName} ${userLastName}
🆔 Telegram: ${username}
📞 Телефон: ${phone}
📷 Фото: <a href="${fileUrl}">Ссылка на фото</a>
✉️ Запрос к фото: ${promptText}
🤖 Ответ: ${description}
      `.trim();

      await bot.sendMessage(LOG_CHAT_ID, logMessage, { parse_mode: "HTML", disable_web_page_preview: false });
      await bot.sendPhoto(LOG_CHAT_ID, fileId, {
        caption: `Фото от пользователя ${username || userFirstName}`,
      });
    } else if (userText) {
      // Обычный текст
      console.log(`📩 Пользователь: ${userText}`);

      history.push({ role: "user", parts: [{ text: userText }] });
      if (history.length > 10) history.splice(0, history.length - 10);
      chatHistory.set(chatId, history);

      const thinkingMsg = await bot.sendMessage(chatId, "🤖 Бот думает...");

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: history,
        config: { thinkingConfig: { thinkingBudget: 0 } },
      });

      const cleaned = cleanResponse(response.text);

      history.push({ role: "model", parts: [{ text: cleaned }] });
      if (history.length > 10) history.splice(0, history.length - 10);
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
    }
  } catch (err) {
    console.error("❌ Ошибка обработки:", err);
    await bot.sendMessage(chatId, "⚠️ Ошибка при обработке вашего сообщения.");
  }
});


console.log("🚀 Telegram бот запущен и слушает сообщения...");
