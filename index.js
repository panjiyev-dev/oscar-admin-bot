// index.js

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// O'zingizning ma'lumotlaringiz bilan almashtiring
const TOKEN = '7586941333:AAHKly13Z3M5qkyKjP-6x-thWvXdJudIHsU';
const ADMIN_CHAT_ID = 7122472578;
const BOT_USERNAME = '@panjiyevdev_newsbot';

// Firebase sozlash (Service Account Key faylini ishlatish)
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Firestore uchun databaseURL emas, balki projectId dan foydalaning; agar Realtime kerak bo'lsa qoldiring
  databaseURL: "https://oscar-d85af.firebaseio.com"  // Agar Firestore ishlatayotgan bo'lsangiz, bu qatorni olib tashlang
});

// Firestore
const db = admin.firestore();

// Bot ishga tushirish
const bot = new TelegramBot(TOKEN, { polling: true });

// User state
const userState = {};

// Main keyboard
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "🛍 Mahsulot qo'shish" }],
      [{ text: "📂 Kategoriya qo'shish" }],
      [{ text: "📊 Ma'lumotlarni ko'rish" }],
    ],
    resize_keyboard: true,
  },
};

// Yordamchi: Next ID
async function getNextId(collectionName) {
  const snapshot = await db.collection(collectionName).orderBy('id', 'desc').limit(1).get();
  if (snapshot.empty) return 1;
  return snapshot.docs[0].data().id + 1;
}

// Bot logikasi
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Admin tekshirish
  if (chatId != ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "Kechirasiz, sizda huquq yo'q.");
    return;
  }

  if (text === '/start') {
    userState[chatId] = { step: 'none' };
    bot.sendMessage(chatId, "Xush kelibsiz! Kerakli amalni tanlang.", mainKeyboard);
    return;
  }

  // Mahsulot qo'shish
  if (text === "🛍 Mahsulot qo'shish") {
    const categoriesSnapshot = await db.collection('categories').get();
    const categoryNames = categoriesSnapshot.docs.map(doc => doc.data().name);

    if (categoryNames.length === 0) {
      bot.sendMessage(chatId, "Avval kategoriya qo'shing. /start bosing.");
      return;
    }

    userState[chatId] = {
      step: 'product_name',
      data: { categoryNames }
    };
    bot.sendMessage(chatId, "1/8. Mahsulot nomini kiriting:");
    return;
  }

  if (userState[chatId] && userState[chatId].step.startsWith('product_')) {
    const step = userState[chatId].step;
    let data = userState[chatId].data;

    switch (step) {
      case 'product_name':
        data.name = text;
        userState[chatId].step = 'product_price';
        bot.sendMessage(chatId, "2/8. Narxni kiriting (raqam, mas: 49900 so'm uchun dona):");
        break;

      case 'product_price':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Noto'g'ri! Musbat son kiriting:");
          return;
        }
        data.price = parseInt(text);
        userState[chatId].step = 'product_discount';
        bot.sendMessage(chatId, "3/8. Chegirma (0-100, mas: 10):");
        break;

      case 'product_discount':
        if (!/^\d+$/.test(text) || parseInt(text) < 0 || parseInt(text) > 100) {
          bot.sendMessage(chatId, "0-100 orasida son kiriting:");
          return;
        }
        data.discount = parseInt(text);
        userState[chatId].step = 'product_category';

        const categoryKeyboard = {
          reply_markup: {
            keyboard: [data.categoryNames],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        };
        bot.sendMessage(chatId, "4/8. Kategoriyani tanlang:", categoryKeyboard);
        break;

      case 'product_category':
        if (!data.categoryNames.includes(text)) {
          bot.sendMessage(chatId, "Kategoriya tanlanmadi! Tugmalardan tanlang:");
          return;
        }
        data.category = text;
        userState[chatId].step = 'product_image';
        bot.sendMessage(chatId, "5/8. Rasm URL (http bilan):");
        break;

      case 'product_image':
        if (!text.startsWith('http')) {
          bot.sendMessage(chatId, "URL noto'g'ri! http bilan boshlang:");
          return;
        }
        data.image = text;
        userState[chatId].step = 'product_description';
        bot.sendMessage(chatId, "6/8. Tavsif kiriting:");
        break;

      case 'product_description':
        data.description = text;
        userState[chatId].step = 'product_box_capacity';
        bot.sendMessage(chatId, "7/8. Har bir karobkada necha dona? (mas: 20):");
        break;

      case 'product_box_capacity':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Musbat son kiriting:");
          return;
        }
        data.boxCapacity = parseInt(text);
        userState[chatId].step = 'product_stock';
        bot.sendMessage(chatId, "8/8. Ombordagi qoldiq dona soni (mas: 60):");
        break;

      case 'product_stock':
        if (!/^\d+$/.test(text) || parseInt(text) < 0) {
          bot.sendMessage(chatId, "Musbat yoki 0 kiriting:");
          return;
        }
        data.stock = parseInt(text);

        // Saqlash
        const newId = await getNextId('products');
        const newProduct = {
          id: newId,
          name: data.name,
          price: data.price,
          discount: data.discount,
          category: data.category,
          image: data.image,
          description: data.description,
          boxCapacity: data.boxCapacity,
          stock: data.stock,
        };

        try {
          await db.collection('products').doc(String(newId)).set(newProduct);
          bot.sendMessage(chatId,
            `✅ Qo'shildi!\nID: ${newId}\nNomi: ${newProduct.name}\nNarx: ${newProduct.price} so'm/dona\nChegirma: ${newProduct.discount}%\nKarobka: ${newProduct.boxCapacity} dona\nStock: ${newProduct.stock} dona`,
            mainKeyboard
          );
        } catch (error) {
          console.error("Xato:", error);
          bot.sendMessage(chatId, "❌ Firebase xatosi!");
        }

        userState[chatId].step = 'none';
        break;
    }
    userState[chatId].data = data;  // Har safar data ni yangilash
    return;
  }

  // Kategoriya qo'shish
  if (text === "📂 Kategoriya qo'shish") {
    userState[chatId] = { step: 'category_name', data: {} };
    bot.sendMessage(chatId, "1/3. Nomi (mas: Oziq-ovqat):");
    return;
  }

  if (userState[chatId] && userState[chatId].step.startsWith('category_')) {
    const step = userState[chatId].step;
    let data = userState[chatId].data || {};

    switch (step) {
      case 'category_name':
        data.name = text;
        userState[chatId].step = 'category_icon';
        bot.sendMessage(chatId, "2/3. Ikonka (emoji, mas: 🥄):");
        break;

      case 'category_icon':
        data.icon = text;
        userState[chatId].step = 'category_color';
        bot.sendMessage(chatId, "3/3. Rang (Tailwind, mas: bg-green-500):");
        break;

      case 'category_color':
        data.color = text;

        const newId = await getNextId('categories');
        const newCategory = {
          id: newId,
          name: data.name,
          icon: data.icon,
          color: data.color,
        };

        try {
          await db.collection('categories').doc(String(newId)).set(newCategory);
          bot.sendMessage(chatId,
            `✅ Kategoriya qo'shildi!\nNomi: ${newCategory.name}\nIkonka: ${newCategory.icon}\nRang: ${newCategory.color}`,
            mainKeyboard
          );
        } catch (error) {
          console.error("Xato:", error);
          bot.sendMessage(chatId, "❌ Firebase xatosi!");
        }

        userState[chatId].step = 'none';
        break;
    }
    userState[chatId].data = data;
    return;
  }

  // Ma'lumotlar ko'rish
  if (text === "📊 Ma'lumotlarni ko'rish") {
    try {
      const productsSnapshot = await db.collection('products').get();
      const categoriesSnapshot = await db.collection('categories').get();
      bot.sendMessage(chatId,
        `📊 Statistikalar:\nMahsulotlar: ${productsSnapshot.size} ta\nKategoriyalar: ${categoriesSnapshot.size} ta\n\nFirestore da saqlanmoqda.`
      );
    } catch (error) {
      console.error("Xato:", error);
      bot.sendMessage(chatId, "❌ Olishda xato!");
    }
    return;
  }

  // Noma'lum
  if (!userState[chatId] || userState[chatId].step === 'none') {
    bot.sendMessage(chatId, "Tugmalardan tanlang.", mainKeyboard);
  }
});

console.log("Bot ishga tushdi...");