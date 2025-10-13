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
    try {
      const productsSnapshot = await db.collection('products').get();
      if (productsSnapshot.empty) {
        bot.sendMessage(chatId, "Hech qanday mahsulot topilmadi.");
        return;
      }

      const products = productsSnapshot.docs.map(doc => {
        const data = doc.data();
        return { id: data.id, name: data.name };
      });

      const inlineKeyboard = {
        reply_markup: {
          inline_keyboard: products.map(p => [{ text: p.name, callback_data: `update_product_${p.id}` }]),
        },
      };

      bot.sendMessage(chatId, "Qaysi mahsulotni yangilashni xohlaysiz? (Inline tugmalardan tanlang):", inlineKeyboard);
    } catch (error) {
      bot.sendMessage(chatId, "❌ Mahsulotlarni olishda xato!");
    }
    return;
  }

  // Update value (text message after field selection)
  if (userState[chatId] && userState[chatId].step === 'update_value') {
    const stateData = userState[chatId].data;
    let value;
    if (stateData.field.includes('price') || stateData.field === 'stock') {
      if (!/^\d+$/.test(text) || parseInt(text) < 0) {
        bot.sendMessage(chatId, "Musbat son kiriting!");
        return;
      }
      value = parseInt(text);
    } else if (stateData.field === 'discount') {
      if (!/^\d+$/.test(text) || parseInt(text) < 0 || parseInt(text) > 100) {
        bot.sendMessage(chatId, "0-100 orasida son kiriting!");
        return;
      }
      value = parseInt(text);
    } else {
      bot.sendMessage(chatId, "Noto'g'ri maydon!");
      userState[chatId].step = 'none';
      return;
    }

    try {
      await db.collection('products').doc(String(stateData.id)).update({ [stateData.field]: value });
      bot.sendMessage(chatId, `✅ ${stateData.field} yangilandi: ${value}`, mainKeyboard);
    } catch (error) {
      bot.sendMessage(chatId, "❌ Yangilashda xato!");
    }

    userState[chatId].step = 'none';
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

  // Kategoriya qo'shish
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

// Callback query handling
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (!data || chatId != ADMIN_CHAT_ID) return;

  if (data.startsWith('update_product_')) {
    const productId = parseInt(data.replace('update_product_', ''));
    try {
      const doc = await db.collection('products').doc(String(productId)).get();
      if (!doc.exists) {
        bot.answerCallbackQuery(callbackQuery.id, { text: "Mahsulot topilmadi!" });
        return;
      }

      const productData = doc.data();
      userState[chatId] = { 
        step: 'update_field', 
        data: { 
          id: productId, 
          product: productData 
        } 
      };

      const updateKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Narx (karobka)", callback_data: `update_field_priceBox_${productId}` }],
            [{ text: "Narx (dona)", callback_data: `update_field_pricePiece_${productId}` }],
            [{ text: "Chegirma", callback_data: `update_field_discount_${productId}` }],
            [{ text: "Stock", callback_data: `update_field_stock_${productId}` }],
            [{ text: "Bekor qilish", callback_data: 'update_cancel' }]
          ],
        },
      };

      const message = `Mahsulot: ${productData.name}\n\n` +
                     `Hozirgi qiymatlar:\n` +
                     `Karobka narxi: ${productData.priceBox} so'm\n` +
                     `Dona narxi: ${productData.pricePiece} so'm\n` +
                     `Chegirma: ${productData.discount}%\n` +
                     `Stock: ${productData.stock} dona\n\n` +
                     `Qaysi maydonni yangilashni xohlaysiz?`;

      bot.editMessageText(message, { chat_id: chatId, message_id: callbackQuery.message.message_id, reply_markup: updateKeyboard.reply_markup });
      bot.answerCallbackQuery(callbackQuery.id, { text: "Tanlandi!" });
    } catch (error) {
      bot.answerCallbackQuery(callbackQuery.id, { text: "Xato yuz berdi!" });
    }
    return;
  }

  if (data.startsWith('update_field_')) {
    const parts = data.split('_');
    if (parts.length < 4) {
      bot.answerCallbackQuery(callbackQuery.id, { text: "Noto'g'ri tanlov!" });
      return;
    }
    const fieldType = parts[2];  // priceBox, pricePiece, etc.
    const productId = parseInt(parts[3]);

    const fieldMap = {
      'priceBox': 'Narx (karobka)',
      'pricePiece': 'Narx (dona)',
      'discount': 'Chegirma',
      'stock': 'Stock'
    };
    const fieldName = fieldMap[fieldType];

    if (!fieldName) {
      bot.answerCallbackQuery(callbackQuery.id, { text: "Noto'g'ri tanlov!" });
      return;
    }

    userState[chatId] = { 
      step: 'update_value', 
      data: { 
        id: productId, 
        field: fieldType 
      } 
    };

    bot.editMessageText(`${fieldName} uchun yangi qiymatni yuboring:`, { 
      chat_id: chatId, 
      message_id: callbackQuery.message.message_id 
    });
    bot.answerCallbackQuery(callbackQuery.id, { text: `${fieldName} tanlandi!` });
    return;
  }

  if (data === 'update_cancel') {
    userState[chatId] = { step: 'none' };
    bot.editMessageText("Yangilash bekor qilindi.", { 
      chat_id: chatId, 
      message_id: callbackQuery.message.message_id 
    });
    bot.answerCallbackQuery(callbackQuery.id, { text: "Bekor qilindi!" });
    return;
  }
});

console.log("Bot ishga tushdi...");