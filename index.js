// ใช้ Webhook แทน polling สำหรับ Deploy บน Render
import TelegramBot from "node-telegram-bot-api";
import express from "express";
import bodyParser from "body-parser";
import fs from "fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const CHECKS_PER_DAY = 5;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000; // 10 นาที
const URL = process.env.RENDER_EXTERNAL_URL || "https://your-app.onrender.com";

const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(bodyParser.json());

bot.setWebHook(`${URL}/bot${BOT_TOKEN}`);

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const employees = JSON.parse(fs.readFileSync("./employees.json", "utf8"));

let currentRound = -1;
let dailyCheckTimes = [];
let dailyResult = {};    // { telegramId: [true/false/...]}
let checkIn = {};        // { telegramId: "09:45" }
let checkOut = {};       // { telegramId: "20:12" }

const ALLOWED_HOURS = [
  [10, 12],
  [13, 16],
  [17, 20]
];

function generateTodaySchedule() {
  const times = [];
  for (const [start, end] of ALLOWED_HOURS) {
    for (let h = start; h < end; h++) {
      for (let m = 0; m < 60; m += 10) {
        times.push(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
      }
    }
  }
  const randomTimes = times.sort(() => Math.random() - 0.5).slice(0, CHECKS_PER_DAY);
  dailyCheckTimes = randomTimes.sort();
}

setInterval(() => {
  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 5);

  if (dailyCheckTimes.includes(timeStr)) {
    currentRound++;
    const roundNum = currentRound + 1;

    for (const emp of employees) {
      if (!dailyResult[emp.telegramId]) dailyResult[emp.telegramId] = [];
      dailyResult[emp.telegramId][currentRound] = false;
    }

    bot.sendMessage(
      GROUP_CHAT_ID,
      `⏰ [WFH CHECK - รอบที่ ${roundNum}/5]\nกรุณาทุกคนพิมพ์ยืนยันการทำงานภายใน 10 นาที`
    );

    setTimeout(() => {
      const missed = employees.filter(emp => !dailyResult[emp.telegramId][currentRound]);
      if (missed.length > 0) {
        bot.sendMessage(
          GROUP_CHAT_ID,
          `⚠️ ไม่พบการตอบกลับรอบที่ ${roundNum} จาก:\n${missed.map(u => "• @" + (u.username || u.name)).join("\n")}`
        );
      }
    }, CHECK_TIMEOUT_MS);
  }
}, 60 * 1000);

bot.on("message", (msg) => {
  if (msg.chat.id.toString() !== GROUP_CHAT_ID.toString()) return;
  const userId = msg.from.id;
  const emp = employees.find(e => e.telegramId === userId);
  if (!emp) return;

  const now = new Date();
  const hour = now.getHours();
  const timeStr = now.toTimeString().slice(0, 5);

  if (hour < 10 && !checkIn[userId]) {
    checkIn[userId] = timeStr;
    bot.sendMessage(GROUP_CHAT_ID, `🟢 @${emp.username || emp.name} เข้างานแล้ว (${timeStr})`);
  }

  if (hour >= 20 && hour <= 21 && !checkOut[userId]) {
    checkOut[userId] = timeStr;
    bot.sendMessage(GROUP_CHAT_ID, `🔵 @${emp.username || emp.name} เลิกงานแล้ว (${timeStr})`);
  }

  if (currentRound !== -1 && dailyResult[userId]?.[currentRound] === false) {
    dailyResult[userId][currentRound] = true;
    bot.sendMessage(GROUP_CHAT_ID, `✅ @${msg.from.username || emp.name} ตอบรอบ ${currentRound + 1} แล้ว`);
  }
});

function sendSummary() {
  const report = [`📊 รายงาน WFH ประจำวันที่ ${new Date().toLocaleDateString("th-TH")}`];

  for (const emp of employees) {
    const id = emp.telegramId;
    const inTime = checkIn[id];
    const outTime = checkOut[id];
    const record = dailyResult[id] || [];
    const pass = record.filter(r => r).length;
    const failRounds = record.map((r, i) => (!r ? i + 1 : null)).filter(Boolean);

    report.push(
      `@${emp.username || emp.name}
🔹 เข้างาน: ${inTime ? `✅ ${inTime}` : "❌ ไม่พบ"}
🔹 เลิกงาน: ${outTime ? `✅ ${outTime}` : "❌ ไม่พบ"}
🔹 ตรวจ WFH: ${failRounds.length === 0 ? "✅ ครบ" : `❌ ขาดรอบ ${failRounds.join(", ")}`}`
    );
  }

  report.push(`\n📌 ระบบจะสุ่มรอบใหม่พรุ่งนี้เวลา 09:59`);
  bot.sendMessage(GROUP_CHAT_ID, report.join("\n\n"));
}

function scheduleSummary() {
  const now = new Date();
  const target = new Date();
  target.setHours(21, 0, 0, 0);
  if (now > target) target.setDate(target.getDate() + 1);
  const delay = target - now;

  setTimeout(() => {
    sendSummary();
    resetDaily();
    scheduleSummary();
  }, delay);
}

function resetDaily() {
  checkIn = {};
  checkOut = {};
  dailyResult = {};
  currentRound = -1;
  generateTodaySchedule();
}

resetDaily();
scheduleSummary();

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("✅ WFH Bot running on port", port));
