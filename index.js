// index.js

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

const TOKEN = '7586941333:AAHKly13Z3M5qkyKjP-6x-thWvXdJudIHsU';
const ADMIN_CHAT_ID = 7122472578;

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://oscar-d85af.firebaseio.com"
});

const db = admin.firestore();
const bot = new TelegramBot(TOKEN, { polling: true });

const userState = {};

const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "🛍 Mahsulot qo'shish" }],
      [{ text: "📂 Kategoriya qo'shish" }],
      [{ text: "🔄 Mahsulotni yangilash" }],
      [{ text: "💱 Dollar kursini o'rnatish" }],
      [{ text: "📊 Ma'lumotlarni ko'rish" }],
    ],
    resize_keyboard: true,
  },
};

async function getNextId(collectionName) {
  const snapshot = await db.collection(collectionName).orderBy('id', 'desc').limit(1).get();
  if (snapshot.empty) return 1;
  return snapshot.docs[0].data().id + 1;
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (chatId != ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "Huquq yo'q.");
    return;
  }

  if (text === '/start') {
    userState[chatId] = { step: 'none' };
    bot.sendMessage(chatId, "Xush kelibsiz!", mainKeyboard);
    return;
  }

  // Mahsulot qo'shish
  if (text === "🛍 Mahsulot qo'shish") {
    const categoriesSnapshot = await db.collection('categories').get();
    const categoryNames = categoriesSnapshot.docs.map(doc => doc.data().name);

    if (categoryNames.length === 0) {
      bot.sendMessage(chatId, "Avval kategoriya qo'shing.");
      return;
    }

    userState[chatId] = { step: 'product_name', data: { categoryNames } };
    bot.sendMessage(chatId, "1/9. Nomi:");
    return;
  }

  if (userState[chatId] && userState[chatId].step.startsWith('product_')) {
    const step = userState[chatId].step;
    let data = userState[chatId].data;

    switch (step) {
      case 'product_name':
        data.name = text;
        userState[chatId].step = 'product_price_box';
        bot.sendMessage(chatId, "2/9. Karobka narxi (raqam):");
        break;

      case 'product_price_box':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Musbat son!");
          return;
        }
        data.priceBox = parseInt(text);
        userState[chatId].step = 'product_price_piece';
        bot.sendMessage(chatId, "3/9. Dona narxi (raqam):");
        break;

      case 'product_price_piece':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Musbat son!");
          return;
        }
        data.pricePiece = parseInt(text);
        userState[chatId].step = 'product_discount';
        bot.sendMessage(chatId, "4/9. Chegirma (0-100):");
        break;

      case 'product_discount':
        if (!/^\d+$/.test(text) || parseInt(text) < 0 || parseInt(text) > 100) {
          bot.sendMessage(chatId, "0-100!");
          return;
        }
        data.discount = parseInt(text);
        userState[chatId].step = 'product_category';
        const categoryKeyboard = { reply_markup: { keyboard: [data.categoryNames], resize_keyboard: true, one_time_keyboard: true } };
        bot.sendMessage(chatId, "5/9. Kategoriya:", categoryKeyboard);
        break;

      case 'product_category':
        if (!data.categoryNames.includes(text)) {
          bot.sendMessage(chatId, "Tugmalardan tanlang!");
          return;
        }
        data.category = text;
        userState[chatId].step = 'product_image';
        bot.sendMessage(chatId, "6/9. Rasm URL:");
        break;

      case 'product_image':
        if (!text.startsWith('http')) {
          bot.sendMessage(chatId, "http bilan!");
          return;
        }
        data.image = text;
        userState[chatId].step = 'product_description';
        bot.sendMessage(chatId, "7/9. Tavsif:");
        break;

      case 'product_description':
        data.description = text;
        userState[chatId].step = 'product_box_capacity';
        bot.sendMessage(chatId, "8/9. Karobkada necha dona:");
        break;

      case 'product_box_capacity':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Musbat son!");
          return;
        }
        data.boxCapacity = parseInt(text);
        userState[chatId].step = 'product_stock';
        bot.sendMessage(chatId, "9/9. Jami stock (dona):");
        break;

      case 'product_stock':
        if (!/^\d+$/.test(text) || parseInt(text) < 0) {
          bot.sendMessage(chatId, "0 yoki musbat!");
          return;
        }
        data.stock = parseInt(text);

        const newId = await getNextId('products');
        const newProduct = {
          id: newId,
          name: data.name,
          priceBox: data.priceBox,
          pricePiece: data.pricePiece,
          discount: data.discount,
          category: data.category,
          image: data.image,
          description: data.description,
          boxCapacity: data.boxCapacity,
          stock: data.stock,
        };

        try {
          await db.collection('products').doc(String(newId)).set(newProduct);
          bot.sendMessage(chatId, `✅ Qo'shildi!\nNomi: ${newProduct.name}\nKarobka narxi: ${newProduct.priceBox} so'm\nDona narxi: ${newProduct.pricePiece} so'm\nStock: ${newProduct.stock} dona`, mainKeyboard);
        } catch (error) {
          bot.sendMessage(chatId, "❌ Xato!");
        }

        userState[chatId].step = 'none';
        break;
    }
    userState[chatId].data = data;
    return;
  }

  // Mahsulot yangilash
  if (text === "🔄 Mahsulotni yangilash") {
    userState[chatId] = { step: 'update_id' };
    bot.sendMessage(chatId, "ID kiriting (masalan: 1):");
    return;
  }

  if (userState[chatId] && userState[chatId].step.startsWith('update_')) {
    const step = userState[chatId].step;
    let data = userState[chatId].data || {};

    switch (step) {
      case 'update_id':
        if (!/^\d+$/.test(text)) {
          bot.sendMessage(chatId, "Raqam ID!");
          return;
        }
        data.id = parseInt(text);
        const doc = await db.collection('products').doc(String(data.id)).get();
        if (!doc.exists) {
          bot.sendMessage(chatId, "ID topilmadi!");
          userState[chatId].step = 'none';
          return;
        }
        userState[chatId].step = 'update_field';
        userState[chatId].data = data;
        const updateKeyboard = {
          reply_markup: {
            keyboard: [
              [{ text: "Narx (karobka)" }, { text: "Narx (dona)" }],
              [{ text: "Chegirma" }, { text: "Stock" }],
              [{ text: "Bekor qilish" }]
            ],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        };
        bot.sendMessage(chatId, "Nima yangilansin?", updateKeyboard);
        break;

      case 'update_field':
        if (text === "Bekor qilish") {
          userState[chatId].step = 'none';
          bot.sendMessage(chatId, "Bekor qilindi.", mainKeyboard);
          return;
        }
        data.field = text.toLowerCase().replace('narx (karobka)', 'priceBox').replace('narx (dona)', 'pricePiece').replace('chegirma', 'discount').replace('stock', 'stock');
        userState[chatId].step = 'update_value';
        bot.sendMessage(chatId, `${text} uchun yangi qiymat kiriting:`);
        break;

      case 'update_value':
        let value;
        if (data.field.includes('price') || data.field === 'stock') {
          if (!/^\d+$/.test(text) || parseInt(text) < 0) {
            bot.sendMessage(chatId, "Musbat son!");
            return;
          }
          value = parseInt(text);
        } else if (data.field === 'discount') {
          if (!/^\d+$/.test(text) || parseInt(text) < 0 || parseInt(text) > 100) {
            bot.sendMessage(chatId, "0-100!");
            return;
          }
          value = parseInt(text);
        } else {
          bot.sendMessage(chatId, "Noto'g'ri field!");
          return;
        }

        try {
          await db.collection('products').doc(String(data.id)).update({ [data.field]: value });
          bot.sendMessage(chatId, `✅ ${data.field} yangilandi: ${value}`, mainKeyboard);
        } catch (error) {
          bot.sendMessage(chatId, "❌ Yangilashda xato!");
        }

        userState[chatId].step = 'none';
        break;
    }
    userState[chatId].data = data;
    return;
  }

  // Dollar kursi
  if (text === "💱 Dollar kursini o'rnatish") {
    userState[chatId] = { step: 'usd_rate' };
    bot.sendMessage(chatId, "USD to UZS kursini kiriting (masalan: 12600):");
    return;
  }

  if (userState[chatId] && userState[chatId].step === 'usd_rate') {
    if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
      bot.sendMessage(chatId, "Musbat son!");
      return;
    }
    try {
      await db.collection('settings').doc('usdRate').set({ rate: parseInt(text) });
      bot.sendMessage(chatId, `✅ USD kursi: 1$ = ${text} so'm`, mainKeyboard);
    } catch (error) {
      bot.sendMessage(chatId, "❌ Xato!");
    }
    userState[chatId].step = 'none';
    return;
  }

  // Kategoriya qo'shish (oldingi kabi)
  if (text === "📂 Kategoriya qo'shish") {
    userState[chatId] = { step: 'category_name', data: {} };
    bot.sendMessage(chatId, "1/3. Nomi:");
    return;
  }

  if (userState[chatId] && userState[chatId].step.startsWith('category_')) {
    const step = userState[chatId].step;
    let data = userState[chatId].data;

    switch (step) {
      case 'category_name':
        data.name = text;
        userState[chatId].step = 'category_icon';
        bot.sendMessage(chatId, "2/3. Ikonka (emoji):");
        break;

      case 'category_icon':
        data.icon = text;
        userState[chatId].step = 'category_color';
        bot.sendMessage(chatId, "3/3. Rang (Tailwind, mas: bg-green-500):");
        break;

      case 'category_color':
        data.color = text;
        const newId = await getNextId('categories');
        const newCategory = { id: newId, name: data.name, icon: data.icon, color: data.color };
        try {
          await db.collection('categories').doc(String(newId)).set(newCategory);
          bot.sendMessage(chatId, `✅ Kategoriya: ${newCategory.name}`, mainKeyboard);
        } catch (error) {
          bot.sendMessage(chatId, "❌ Xato!");
        }
        userState[chatId].step = 'none';
        break;
    }
    userState[chatId].data = data;
    return;
  }

  // Ma'lumotlar
  if (text === "📊 Ma'lumotlarni ko'rish") {
    try {
      const productsSnapshot = await db.collection('products').get();
      const categoriesSnapshot = await db.collection('categories').get();
      const settingsSnapshot = await db.collection('settings').doc('usdRate').get();
      const usdRate = settingsSnapshot.exists ? settingsSnapshot.data().rate : 'Belgilanmagan';
      bot.sendMessage(chatId, `📊 Stat:\nMahsulotlar: ${productsSnapshot.size}\nKategoriyalar: ${categoriesSnapshot.size}\nUSD: ${usdRate}`, mainKeyboard);
    } catch (error) {
      bot.sendMessage(chatId, "❌ Xato!");
    }
    return;
  }

  if (!userState[chatId] || userState[chatId].step === 'none') {
    bot.sendMessage(chatId, "Tugmalardan tanlang.", mainKeyboard);
  }
});

console.log("Bot ishga tushdi...");