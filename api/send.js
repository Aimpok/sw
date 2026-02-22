const admin = require("firebase-admin");

// Инициализируем Firebase только один раз
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel иногда ломает переносы строк в ключах, этот фикс всё чинит:
      privateKey: process.env.FIREBASE_PRIVATE_KEY 
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
        : undefined,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

export default async function handler(req, res) {
  // Разрешаем CORS (чтобы запросы с телефона проходили)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    console.log("[Vercel] OPTIONS request received, returning 200.");
    return res.status(200).end();
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      console.error("[Vercel ERROR] Failed to parse JSON body:", e);
      return res.status(400).json({ error: "Invalid JSON body", detail: e.message });
    }
  }
  body = body || {}; // Ensure body is an object even if empty

  const { senderId, receiverId, text } = body;
  console.log(`[Vercel REQUEST] From: ${senderId} to: ${receiverId}, message: "${text}"`);

  if (!senderId || !receiverId || !text) {
    console.error("[Vercel ERROR] Missing data in request body.");
    return res.status(400).json({ error: "Missing data (senderId, receiverId, or text)", received: body });
  }

  try {
    // 1. Ищем токен получателя
    const receiverSnap = await admin.database().ref(`/users/${receiverId}`).once('value');
    const receiver = receiverSnap.val();

    if (!receiver) {
      console.log(`[Vercel FAIL] Receiver with ID ${receiverId} not found in database.`);
      return res.status(200).json({ status: "User not found" });
    }

    if (!receiver.fcmToken) {
      console.log(`[Vercel FAIL] Receiver ${receiverId} has no FCM token.`);
      return res.status(200).json({ status: "No token" });
    }
    console.log(`[Vercel INFO] FCM Token for ${receiverId} found: ${receiver.fcmToken.substring(0, 10)}...`);

    // =========================================================
    // !!! ВРЕМЕННО ОТКЛЮЧАЕМ ПРОВЕРКУ СТАТУСА ONLINE ДЛЯ ТЕСТА !!!
    // =========================================================
    // Чтобы пуши приходили даже когда пользователь в сети
    /*
    if (receiver.status === "Online") {
      console.log(`[Vercel SKIP] Receiver ${receiverId} is Online. Skipping push notification.`);
      return res.status(200).json({ status: "User online, skipping push" });
    }
    */
    console.log(`[Vercel INFO] Receiver status is ${receiver.status}. Sending push.`);
    // =========================================================

    // 2. Ищем имя отправителя
    const senderSnap = await admin.database().ref(`/users/${senderId}`).once('value');
    const sender = senderSnap.val();
    const senderName = sender ? sender.name : "New Message";
    console.log(`[Vercel INFO] Sender name: ${senderName}`);

    // 3. Шлем пуш
    const message = {
      token: receiver.fcmToken,
      data: {
        title: senderName,
        body: text,
        senderId: senderId
      },
      android: {
        priority: "high"
      }
    };

    console.log(`[Vercel SENDING] Attempting to send push to ${receiverId}...`);
    const response = await admin.messaging().send(message);
    console.log("[Vercel SUCCESS] Push sent via FCM:", response);
    
    return res.status(200).json({ success: true, fcmMessageId: response });

  } catch (error) {
    console.error("[Vercel CRITICAL ERROR] Failed to send push:", error);
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
