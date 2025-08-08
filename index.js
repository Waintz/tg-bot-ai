import TelegramBot from "node-telegram-bot-api";
import { GoogleGenAI } from "@google/genai";
import fetch from "node-fetch";
import iconv from "iconv-lite";
import fs from "fs";

const tgToken = "8446844336:AAGesDgSjRvtxWKetfMJnMThGCmUd2brhrQ";
const geminiApiKey = "AIzaSyBN6tQRclDhbPjh3LMoolhmQMUrETVsHqk";
const LOG_CHAT_ID = -1002804779527;

const filePath = "./prices.json";
const buffer = fs.readFileSync(filePath);
const text = iconv.decode(buffer, "win1251");
const data = JSON.parse(text);

const normalize = (str) =>
  str.toLowerCase().replace(/\s+/g, " ").replace(/[ё]/g, "е").trim();

const itemsMap = {};
for (const key of Object.keys(data.list)) {
  itemsMap[normalize(key)] = key;
}

const bot = new TelegramBot(tgToken, { polling: true });
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

const chatHistory = new Map();

const userModes = new Map();

function cleanResponse(text) {
  return text
    .replace(/\$\$([^$]+)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\*\*+/g, "")
    .trim();
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `👋 Привет! Я умею работать в двух режимах:

🤖 /gpt — режим общения с нейросетью (можно писать вопросы, отправлять фото)
📦 /items — режим поиска предметов по базе цен

Выберите нужный режим командой.`
  );
  userModes.delete(chatId);
});

bot.onText(/\/gpt/, (msg) => {
  const chatId = msg.chat.id;
  userModes.set(chatId, "gpt");
  bot.sendMessage(
    chatId,
    "✅ Включён режим GPT. Пишите сообщения или отправляйте фото."
  );
});

bot.onText(/\/items/, (msg) => {
  const chatId = msg.chat.id;
  userModes.set(chatId, "items");
  bot.sendMessage(
    chatId,
    "📦 Включён режим поиска предметов. Напишите название предмета."
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const mode = userModes.get(chatId);
  const userText = msg.text?.trim() || msg.caption?.trim();
  const hasPhoto = !!msg.photo;

  if (userText?.startsWith("/")) return;

  if (!mode) {
    bot.sendMessage(chatId, "⚠️ Сначала выберите режим: /gpt или /items");
    return;
  }

  if (mode === "items") {
    if (!userText) return;

    const normalized = normalize(userText);
    const foundKey = itemsMap[normalized];

    if (!foundKey) {
      bot.sendMessage(chatId, "❌ Такого предмета нет в базе.");
      return;
    }

    const itemData = data.list[foundKey];
    const saPrice =
      itemData.sa?.price !== undefined
        ? itemData.sa.price.toLocaleString("ru-RU")
        : "нет данных";
    const vcPrice =
      itemData.vc?.price !== undefined
        ? itemData.vc.price.toLocaleString("ru-RU")
        : "нет данных";

    bot.sendMessage(
      chatId,
      `🔍 Предмет: ${foundKey}\n💰 Цена SA: ${saPrice}\n💰 Цена VC: ${vcPrice}`
    );
  }

  if (mode === "gpt") {
    let history = chatHistory.get(chatId) || [];

    const userFirstName = msg.from?.first_name || "Неизвестно";
    const userLastName = msg.from?.last_name || "";
    const username = msg.from?.username ? `@${msg.from.username}` : "не указан";
    const phone = msg.contact?.phone_number || "не указан";

    try {
      if (hasPhoto) {
        const photos = msg.photo;
        const fileId = photos[photos.length - 1].file_id;
        const file = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${tgToken}/${file.file_path}`;

        const resp = await fetch(fileUrl);
        if (!resp.ok) throw new Error(`Ошибка загрузки файла: ${resp.status}`);
        const buffer = await resp.arrayBuffer();
        const base64Image = Buffer.from(buffer).toString("base64");

        const ext = file.file_path.split(".").pop().toLowerCase();
        let mimeType = "image/jpeg";
        if (ext === "png") mimeType = "image/png";
        else if (ext === "webp") mimeType = "image/webp";

        const promptText =
          msg.caption?.trim() || "Опиши, что изображено на этой фотографии.";


        await bot.sendPhoto(LOG_CHAT_ID, fileId, {
          caption: `📷 [GPT Режим] Фото от ${userFirstName} ${userLastName}
🆔 Telegram: ${username}
📞 Телефон: ${phone}
📝 Подпись: ${promptText}`,
        });

        const contents = [
          {
            role: "user",
            parts: [{ inlineData: { mimeType, data: base64Image } }],
          },
          { role: "user", parts: [{ text: promptText }] },
        ];

        const thinkingMsg = await bot.sendMessage(chatId, "🤖 Бот думает...");

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents,
          config: { thinkingConfig: { thinkingBudget: 0 } },
        });

        const description = cleanResponse(response.text);

        history.push({
          role: "user",
          parts: [{ text: `Фото + запрос: ${promptText}` }],
        });
        history.push({ role: "model", parts: [{ text: description }] });
        if (history.length > 10) history.splice(0, history.length - 10);
        chatHistory.set(chatId, history);

        await bot.editMessageText(description, {
          chat_id: chatId,
          message_id: thinkingMsg.message_id,
          parse_mode: "HTML",
        });
      } else if (userText) {

        await bot.sendMessage(
          LOG_CHAT_ID,
          `💬 [GPT Режим] Сообщение от ${userFirstName} ${userLastName}
🆔 Telegram: ${username}
📞 Телефон: ${phone}
📝 Сообщение: ${userText}`
        );

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

        await bot.editMessageText(cleaned, {
          chat_id: chatId,
          message_id: thinkingMsg.message_id,
          parse_mode: "HTML",
        });
      }
    } catch (err) {
      console.error("❌ Ошибка обработки:", err);
      await bot.sendMessage(chatId, "⚠️ Ошибка при обработке сообщения.");
    }
  }
});

console.log("🚀 Telegram бот запущен и слушает сообщения...");
