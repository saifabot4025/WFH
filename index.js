// ✅ WFH Bot (Telegram) – Thai Timezone + Stealth Round System
import TelegramBot from "node-telegram-bot-api";
import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import { zonedTimeToUtc } from "date-fns-tz";

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const CHECKS_PER_DAY = 5;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
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
let dailyResult = {};
let checkIn = {};
let checkOut = {};
let lateIn = {};

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
        times.push(\`\${h.toString().padStart(2, "0")}:\${m.toString().padStart(2, "0")}\`);
      }
    }
  }
  const randomTimes = times.sort(() => 0.5 - Math.random()).slice(0, CHECKS_PER_DAY);
  dailyCheckTimes = randomTimes.sort();
  console.log("✅ รอบตรวจสุ่มวันนี้:", dailyCheckTimes);
}

function isNowInCheckTimes() {
  const current = new Date().toLocaleTimeString("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return dailyCheckTimes.includes(current);
}

function handleCheckRound() {
  currentRound++;
  for (const emp of employees) {
    if (!dailyResult[emp.telegramId]) dailyResult[emp.telegramId] = [];
    dailyResult[emp.telegramId][currentRound] = false;
  }
  bot.sendMessage(
    GROUP_CHAT_ID,
    \`⏰ แจ้งเตือนตรวจการทำงานรอบสุ่ม
กรุณาพิมพ์ยืนยันการทำงานภายใน 10 นาที\`
  );
  setTimeout(() => {
    const missed = employees.filter(emp => !dailyResult[emp.telegramId][currentRound]);
    if (missed.length > 0) {
      bot.sendMessage(
        GROUP_CHAT_ID,
        \`⚠️ ขาดการตอบกลับในรอบนี้จาก:
\` +
        missed.map(u => \`• @\${u.username || u.name}\`).join("\n")
      );
    }
  }, CHECK_TIMEOUT_MS);
}

setInterval(() => {
  if (isNowInCheckTimes()) handleCheckRound();
}, 60 * 1000);

bot.on("message", (msg) => {
  if (msg.chat.id.toString() !== GROUP_CHAT_ID.toString()) return;
  const userId = msg.from.id;
  const emp = employees.find(e => e.telegramId === userId);
  if (!emp) return;

  const timeStr = new Date().toLocaleTimeString("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const hour = parseInt(timeStr.split(":")[0]);

  if (!checkIn[userId]) {
    checkIn[userId] = timeStr;
    if (hour >= 10) {
      lateIn[userId] = true;
      bot.sendMessage(GROUP_CHAT_ID, \`🟡 @\${emp.username || emp.name} เข้างานสาย (\${timeStr})\`);
    } else {
      bot.sendMessage(GROUP_CHAT_ID, \`🟢 @\${emp.username || emp.name} เข้างานแล้ว (\${timeStr})\`);
    }
  }

  if (hour >= 20 && hour <= 21 && !checkOut[userId]) {
    checkOut[userId] = timeStr;
    bot.sendMessage(GROUP_CHAT_ID, \`🔵 @\${emp.username || emp.name} เลิกงานแล้ว (\${timeStr})\`);
  }

  if (currentRound !== -1 && dailyResult[userId]?.[currentRound] === false) {
    dailyResult[userId][currentRound] = true;
    bot.sendMessage(GROUP_CHAT_ID, \`✅ @\${msg.from.username || emp.name} ยืนยันรอบนี้แล้ว\`);
  }
});

function sendSummary() {
  const today = new Date().toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" });
  const report = [\`📊 รายงานการทำงานประจำวันที่ \${today}\`];

  for (const emp of employees) {
    const id = emp.telegramId;
    const inTime = checkIn[id];
    const outTime = checkOut[id];
    const record = dailyResult[id] || [];
    const failRounds = record.map((r, i) => (!r ? i + 1 : null)).filter(Boolean);

    report.push(
      \`@\${emp.username || emp.name}
🔹 เข้างาน: \${inTime ? (lateIn[id] ? \`🟡 สาย \${inTime}\` : \`✅ \${inTime}\`) : "❌ ไม่พบ"}
🔹 เลิกงาน: \${outTime ? \`✅ \${outTime}\` : "❌ ไม่พบ"}
🔹 การตอบสนอง: \${failRounds.length === 0 ? "✅ ครบ" : \`❌ ขาดรอบที่ \${failRounds.join(", ")}\`}\`
    );
  }

  report.push(\`\n📌 ระบบจะสุ่มรอบใหม่อัตโนมัติในวันถัดไป\`);
  bot.sendMessage(GROUP_CHAT_ID, report.join("\n\n"));
}

function scheduleSummary() {
  const timeZone = "Asia/Bangkok";
  const now = new Date();
  const todayTarget = new Date();
  todayTarget.setHours(21, 0, 0, 0);
  const utcTarget = zonedTimeToUtc(todayTarget, timeZone);
  if (now > utcTarget) utcTarget.setDate(utcTarget.getDate() + 1);
  const delay = utcTarget.getTime() - now.getTime();
  setTimeout(() => {
    sendSummary();
    resetDaily();
    scheduleSummary();
  }, delay);
}

function resetDaily() {
  checkIn = {};
  checkOut = {};
  lateIn = {};
  dailyResult = {};
  currentRound = -1;
  generateTodaySchedule();
}

resetDaily();
scheduleSummary();

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("✅ WFH Bot running on port", port));
