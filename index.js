import TelegramBot from "node-telegram-bot-api";
import fs from "fs";

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const CHECKS_PER_DAY = 5;
const CHECK_TIMEOUT_MS = 10 * 60 * 1000; // 10 นาที

// ===== INIT =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const employees = JSON.parse(fs.readFileSync("./employees.json", "utf8"));

// ===== STATE =====
let currentRound = -1;
let dailyCheckTimes = [];
let dailyResult = {};    // { telegramId: [true/false/...]}
let checkIn = {};        // { telegramId: "09:45" }
let checkOut = {};       // { telegramId: "20:12" }

// ===== TIME UTILS =====
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

// ===== CHECK EVERY MINUTE =====
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

// ===== HANDLE MESSAGE =====
bot.on("message", (msg) => {
  if (msg.chat.id.toString() !== GROUP_CHAT_ID.toString()) return;

  const userId = msg.from.id;
  const emp = employees.find(e => e.telegramId === userId);
  if (!emp) return;

  const now = new Date();
  const hour = now.getHours();
  const timeStr = now.toTimeString().slice(0, 5);

  // เข้างาน
  if (hour < 10 && !checkIn[userId]) {
    checkIn[userId] = timeStr;
    bot.sendMessage(GROUP_CHAT_ID, `🟢 @${emp.username || emp.name} เข้างานแล้ว (${timeStr})`);
  }

  // เลิกงาน
  if (hour >= 20 && hour <= 21 && !checkOut[userId]) {
    checkOut[userId] = timeStr;
    bot.sendMessage(GROUP_CHAT_ID, `🔵 @${emp.username || emp.name} เลิกงานแล้ว (${timeStr})`);
  }

  // ตอบรอบ WFH
  if (currentRound !== -1 && dailyResult[userId]?.[currentRound] === false) {
    dailyResult[userId][currentRound] = true;
    bot.sendMessage(GROUP_CHAT_ID, `✅ @${msg.from.username || emp.name} ตอบรอบ ${currentRound + 1} แล้ว`);
  }
});

// ===== DAILY SUMMARY =====
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
