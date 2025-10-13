// index.js

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// Bot va Admin ma'lumotlari
const TOKEN = '7586941333:AAHKly13Z3M5qkyKjP-6x-thWvXdJudIHsU';
const ADMIN_CHAT_ID = 7122472578; // Admin chat ID

// Firebase'ni sozlash
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://oscar-d85af.firebaseio.com"
});

const db = admin.firestore();
const bot = new TelegramBot(TOKEN, { polling: true });

const userState = {}; // Foydalanuvchi holatini (step, data) saqlash

// Asosiy boshqaruv klaviaturasi
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "🛍 Mahsulot qo'shish" }, { text: "📂 Kategoriya qo'shish" }],
      [{ text: "🔄 Mahsulotni yangilash" }, { text: "💱 Dollar kursini o'rnatish" }],
      [{ text: "📊 Ma'lumotlarni ko'rish" }],
    ],
    resize_keyboard: true,
  },
};

/**
 * Berilgan collection ichidagi eng katta IDni topib, uning keyingisini qaytaradi.
 * @param {string} collectionName - Firestore to'plami nomi.
 * @returns {Promise<number>} - Keyingi ID.
 */
async function getNextId(collectionName) {
  try {
    const snapshot = await db.collection(collectionName).orderBy('id', 'desc').limit(1).get();
    if (snapshot.empty) return 1;
    return snapshot.docs[0].data().id + 1;
  } catch (error) {
    console.error(`Error in getNextId for ${collectionName}:`, error);
    return -1; // Xato bo'lsa salbiy qiymat qaytaramiz
  }
}

// Asosiy message handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Faqat admin uchun ruxsat
  if (chatId != ADMIN_CHAT_ID) {
    bot.sendMessage(chatId, "Bu bot faqat administratorlar uchun mo'ljallangan.");
    return;
  }

  // /start buyrug'i
  if (text === '/start') {
    userState[chatId] = { step: 'none' };
    bot.sendMessage(chatId, "Xush kelibsiz! Admin paneliga kirish uchun tugmalardan birini tanlang.", mainKeyboard);
    return;
  }
  
  // Ma'lumot kirishni bekor qilish uchun umumiy funksiya (ixtiyoriy)
  if (text === "❌ Bekor qilish") {
      userState[chatId] = { step: 'none' };
      bot.sendMessage(chatId, "Joriy amal bekor qilindi.", mainKeyboard);
      return;
  }

  // --- 🛍 Mahsulot qo'shish buyrug'i ---
  if (text === "🛍 Mahsulot qo'shish") {
    const categoriesSnapshot = await db.collection('categories').get();
    const categoryNames = categoriesSnapshot.docs.map(doc => doc.data().name);

    if (categoryNames.length === 0) {
      bot.sendMessage(chatId, "Avval kategoriya qo'shing. '📂 Kategoriya qo'shish' ni tanlang.", mainKeyboard);
      return;
    }

    userState[chatId] = { step: 'product_name', data: { categoryNames } };
    bot.sendMessage(chatId, "1/9. Mahsulot nomini kiriting:");
    return;
  }

  // --- Mahsulot qo'shish bosqichlari ---
  if (userState[chatId] && userState[chatId].step.startsWith('product_')) {
    const step = userState[chatId].step;
    let data = userState[chatId].data;

    switch (step) {
      case 'product_name':
        data.name = text;
        userState[chatId].step = 'product_price_box';
        bot.sendMessage(chatId, "2/9. Karobka narxi (raqam, mas: 200000):");
        break;

      case 'product_price_box':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Musbat son kiriting!");
          return;
        }
        data.priceBox = parseInt(text);
        userState[chatId].step = 'product_price_piece';
        bot.sendMessage(chatId, "3/9. Dona narxi (raqam, mas: 500):");
        break;

      case 'product_price_piece':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Musbat son kiriting!");
          return;
        }
        data.pricePiece = parseInt(text);
        userState[chatId].step = 'product_discount';
        bot.sendMessage(chatId, "4/9. Chegirma (0-100, mas: 10):");
        break;

      case 'product_discount':
        if (!/^\d+$/.test(text) || parseInt(text) < 0 || parseInt(text) > 100) {
          bot.sendMessage(chatId, "0 dan 100 gacha son kiriting!");
          return;
        }
        data.discount = parseInt(text);
        userState[chatId].step = 'product_category';
        // Kategoriyalarni bir qatorda ko'rsatish uchun tuzish
        const categoryKeyboard = { 
          reply_markup: { 
            keyboard: [data.categoryNames.map(name => ({ text: name }))], 
            resize_keyboard: true, 
            one_time_keyboard: true 
          } 
        };
        bot.sendMessage(chatId, "5/9. Kategoriyani tanlang:", categoryKeyboard);
        break;

      case 'product_category':
        if (!data.categoryNames.includes(text)) {
          bot.sendMessage(chatId, "Iltimos, kategoriyani tugmalardan tanlang!");
          return;
        }
        data.category = text;
        userState[chatId].step = 'product_image';
        bot.sendMessage(chatId, "6/9. Rasm URL (http yoki https bilan boshlanishi kerak):");
        break;

      case 'product_image':
        if (!text.startsWith('http')) {
          bot.sendMessage(chatId, "Rasm URL manzili 'http' yoki 'https' bilan boshlanishi kerak!");
          return;
        }
        data.image = text;
        userState[chatId].step = 'product_description';
        bot.sendMessage(chatId, "7/9. Tavsif (qisqa ma'lumot):");
        break;

      case 'product_description':
        data.description = text;
        userState[chatId].step = 'product_box_capacity';
        bot.sendMessage(chatId, "8/9. Har bir karobkada necha dona bor (raqam, mas: 20):");
        break;

      case 'product_box_capacity':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Musbat son kiriting!");
          return;
        }
        data.boxCapacity = parseInt(text);
        userState[chatId].step = 'product_stock';
        bot.sendMessage(chatId, "9/9. Ombordagi jami stock (dona soni, mas: 100):");
        break;

      case 'product_stock':
        if (!/^\d+$/.test(text) || parseInt(text) < 0) {
          bot.sendMessage(chatId, "0 yoki musbat son kiriting!");
          return;
        }
        data.stock = parseInt(text);

        // Yangi mahsulotni saqlash
        const newId = await getNextId('products');
        if (newId === -1) {
            bot.sendMessage(chatId, "❌ Mahsulot ID sini olishda xato yuz berdi!", mainKeyboard);
            userState[chatId].step = 'none';
            return;
        }
        
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
          bot.sendMessage(chatId, 
            `✅ Mahsulot **muvaffaqiyatli qo'shildi!**\n\n` +
            `**Nomi:** ${newProduct.name}\n` +
            `**Karobka narxi:** ${newProduct.priceBox.toLocaleString()} so'm\n` +
            `**Dona narxi:** ${newProduct.pricePiece.toLocaleString()} so'm\n` +
            `**Chegirma:** ${newProduct.discount}%\n` +
            `**Stock:** ${newProduct.stock.toLocaleString()} dona`, 
            mainKeyboard
          );
        } catch (error) {
          console.error("Mahsulot qo'shishda xato:", error);
          bot.sendMessage(chatId, "❌ Mahsulot qo'shishda xato yuz berdi!");
        }

        userState[chatId].step = 'none';
        break;
    }
    // data'ni har bir bosqichda yangilash
    userState[chatId].data = data;
    return;
  }

  // --- Kategoriya qo'shish buyrug'i ---
  if (text === "📂 Kategoriya qo'shish") {
    userState[chatId] = { step: 'category_name', data: {} };
    bot.sendMessage(chatId, "1/3. Kategoriya nomini kiriting (mas: Oziq-ovqat):");
    return;
  }

  // --- Kategoriya qo'shish bosqichlari ---
  if (userState[chatId] && userState[chatId].step.startsWith('category_')) {
    const step = userState[chatId].step;
    let data = userState[chatId].data;

    switch (step) {
      case 'category_name':
        data.name = text;
        userState[chatId].step = 'category_icon';
        bot.sendMessage(chatId, "2/3. Ikonka (emoji, mas: 🥄):");
        break;

      case 'category_icon':
        data.icon = text;
        userState[chatId].step = 'category_color';
        bot.sendMessage(chatId, "3/3. Rang (Tailwind CSS rangi, mas: bg-green-500):");
        break;

      case 'category_color':
        data.color = text;
        const newId = await getNextId('categories');
         if (newId === -1) {
            bot.sendMessage(chatId, "❌ Kategoriya ID sini olishda xato yuz berdi!", mainKeyboard);
            userState[chatId].step = 'none';
            return;
        }
        
        const newCategory = { id: newId, name: data.name, icon: data.icon, color: data.color };
        try {
          await db.collection('categories').doc(String(newId)).set(newCategory);
          bot.sendMessage(chatId, 
            `✅ Kategoriya **muvaffaqiyatli qo'shildi!**\n\n` +
            `**Nomi:** ${newCategory.name}\n` +
            `**Ikonka:** ${newCategory.icon}\n` +
            `**Rang:** ${newCategory.color}`, 
            mainKeyboard
          );
        } catch (error) {
          console.error("Kategoriya qo'shishda xato:", error);
          bot.sendMessage(chatId, "❌ Kategoriya qo'shishda xato yuz berdi!");
        }
        userState[chatId].step = 'none';
        break;
    }
    userState[chatId].data = data;
    return;
  }

  // --- Dollar kursini o'rnatish buyrug'i ---
  if (text === "💱 Dollar kursini o'rnatish") {
    userState[chatId] = { step: 'usd_rate' };
    bot.sendMessage(chatId, "USD to UZS kursini kiriting (masalan: 12600):");
    return;
  }

  // --- Dollar kursi o'rnatish bosqichi ---
  if (userState[chatId] && userState[chatId].step === 'usd_rate') {
    if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
      bot.sendMessage(chatId, "Iltimos, musbat son kiriting!");
      return;
    }
    try {
      const rate = parseInt(text);
      await db.collection('settings').doc('usdRate').set({ rate: rate });
      bot.sendMessage(chatId, `✅ **USD kursi o'rnatildi:** 1$ = ${rate.toLocaleString()} so'm`, mainKeyboard);
    } catch (error) {
      console.error("Kurs o'rnatishda xato:", error);
      bot.sendMessage(chatId, "❌ Kurs o'rnatishda xato yuz berdi!");
    }
    userState[chatId].step = 'none';
    return;
  }

  // --- Mahsulot yangilash buyrug'i ---
  if (text === "🔄 Mahsulotni yangilash") {
    try {
      const productsSnapshot = await db.collection('products').get();
      if (productsSnapshot.empty) {
        bot.sendMessage(chatId, "Hech qanday mahsulot topilmadi. Avval qo'shing.", mainKeyboard);
        return;
      }

      const products = productsSnapshot.docs.map(doc => {
        const data = doc.data();
        return { id: data.id, name: data.name };
      });

      const inlineKeyboard = {
        reply_markup: {
          inline_keyboard: []
        },
      };

      // Inline tugmalarni 2 tadan qilib joylash
      for (let i = 0; i < products.length; i += 2) {
        const row = [{ text: products[i].name, callback_data: `update_product_${products[i].id}` }];
        if (i + 1 < products.length) {
          row.push({ text: products[i + 1].name, callback_data: `update_product_${products[i + 1].id}` });
        }
        inlineKeyboard.reply_markup.inline_keyboard.push(row);
      }
      
      bot.sendMessage(chatId, "Qaysi mahsulotni yangilashni xohlaysiz? (Inline tugmalardan tanlang):", inlineKeyboard);
    } catch (error) {
      console.error("Mahsulotlar olishda xato:", error);
      bot.sendMessage(chatId, "❌ Mahsulotlarni olishda xato yuz berdi!", mainKeyboard);
    }
    return;
  }
  
  // --- Yangi qiymatni qabul qilish bosqichi (update_value) ---
  if (userState[chatId] && userState[chatId].step === 'update_value') {
    const stateData = userState[chatId].data;
    let value;
    let fieldType = stateData.field;
    let fieldNameUz;

    // Qiymatni tekshirish va o'zlashtirish
    if (fieldType.includes('price') || fieldType === 'stock') {
      fieldNameUz = fieldType === 'stock' ? 'Stock' : (fieldType === 'priceBox' ? 'Karobka narxi' : 'Dona narxi');
      if (!/^\d+$/.test(text) || parseInt(text) < 0) {
        bot.sendMessage(chatId, `Iltimos, ${fieldNameUz} uchun 0 yoki musbat son kiriting!`);
        return;
      }
      value = parseInt(text);
    } else if (fieldType === 'discount') {
      fieldNameUz = 'Chegirma';
      if (!/^\d+$/.test(text) || parseInt(text) < 0 || parseInt(text) > 100) {
        bot.sendMessage(chatId, "Iltimos, Chegirma uchun 0-100 orasida son kiriting!");
        return;
      }
      value = parseInt(text);
    } else {
      bot.sendMessage(chatId, "Noto'g'ri maydon aniqlandi!");
      userState[chatId].step = 'none';
      return;
    }

    try {
      await db.collection('products').doc(String(stateData.id)).update({ [fieldType]: value });
      bot.sendMessage(chatId, 
        `✅ **${fieldNameUz}** yangilandi: **${value.toLocaleString()}** ${fieldType === 'discount' ? '%' : 'so\'m/dona'}\n\n` +
        `Endi boshqa amalni tanlang.`, 
        mainKeyboard
      );
    } catch (error) {
      console.error("Yangilashda xato:", error);
      bot.sendMessage(chatId, "❌ Yangilashda xato yuz berdi!", mainKeyboard);
    }

    userState[chatId].step = 'none';
    return;
  }

  // --- Ma'lumotlarni ko'rish buyrug'i ---
  if (text === "📊 Ma'lumotlarni ko'rish") {
    try {
      const productsSnapshot = await db.collection('products').get();
      const categoriesSnapshot = await db.collection('categories').get();
      const settingsSnapshot = await db.collection('settings').doc('usdRate').get();
      const usdRate = settingsSnapshot.exists ? settingsSnapshot.data().rate : 'Belgilanmagan';

      bot.sendMessage(chatId, 
        `📊 **Statistika:**\n\n` +
        `🔹 **Mahsulotlar soni:** ${productsSnapshot.size.toLocaleString()} ta\n` +
        `🔹 **Kategoriyalar soni:** ${categoriesSnapshot.size.toLocaleString()} ta\n` +
        `💱 **USD kursi:** ${usdRate === 'Belgilanmagan' ? usdRate : usdRate.toLocaleString() + ' so\'m'}\n\n` +
        `Barcha ma'lumotlar Firestore (Firebase) da saqlanmoqda.`, 
        mainKeyboard
      );
    } catch (error) {
      console.error("Statistika olishda xato:", error);
      bot.sendMessage(chatId, "❌ Ma'lumotlarni olishda xato yuz berdi!", mainKeyboard);
    }
    return;
  }

  // --- Noma'lum buyruq ---
  if (!userState[chatId] || userState[chatId].step === 'none') {
    bot.sendMessage(chatId, "Tushunmadim. Iltimos, quyidagi tugmalardan birini tanlang:", mainKeyboard);
  }
});

// Callback query handler (inline tugmalar uchun)
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  // Xavfsizlik tekshiruvi
  if (!data || chatId != ADMIN_CHAT_ID) {
    bot.answerCallbackQuery(callbackQuery.id, { text: "Ruxsat yo'q!" });
    return;
  }

  // --- Mahsulot tanlandi (update_product_ID) ---
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
            [{ text: `Karobka narxi: ${productData.priceBox.toLocaleString()} so'm`, callback_data: `update_field_priceBox_${productId}` }],
            [{ text: `Dona narxi: ${productData.pricePiece.toLocaleString()} so'm`, callback_data: `update_field_pricePiece_${productId}` }],
            [{ text: `Chegirma: ${productData.discount}%`, callback_data: `update_field_discount_${productId}` }],
            [{ text: `Stock: ${productData.stock.toLocaleString()} dona`, callback_data: `update_field_stock_${productId}` }],
            [{ text: "❌ Bekor qilish", callback_data: 'update_cancel' }]
          ],
        },
      };

      const message = `📝 **Mahsulot:** ${productData.name} (ID: ${productId})\n\n` +
                     `Hozirgi qiymatlar:\n` +
                     `• **Karobka narxi:** ${productData.priceBox.toLocaleString()} so'm\n` +
                     `• **Dona narxi:** ${productData.pricePiece.toLocaleString()} so'm\n` +
                     `• **Chegirma:** ${productData.discount}%\n` +
                     `• **Stock:** ${productData.stock.toLocaleString()} dona\n\n` +
                     `Qaysi maydonni yangilashni xohlaysiz? (Tugmani bosing)`;

      bot.editMessageText(message, { 
        chat_id: chatId, 
        message_id: callbackQuery.message.message_id, 
        reply_markup: updateKeyboard.reply_markup,
        parse_mode: 'Markdown'
      });
      bot.answerCallbackQuery(callbackQuery.id, { text: "Mahsulot tanlandi! Endi maydon tanlang." });
    } catch (error) {
      console.error("Mahsulotni tanlashda xato:", error);
      bot.answerCallbackQuery(callbackQuery.id, { text: "Xato yuz berdi!" });
    }
    return;
  }

  // --- Yangilash maydoni tanlandi (update_field_FIELD_ID) ---
  if (data.startsWith('update_field_')) {
    const parts = data.split('_');
    if (parts.length !== 4) {
      bot.answerCallbackQuery(callbackQuery.id, { text: "Noto'g'ri tanlov!" });
      return;
    }
    const fieldType = parts[2];  // priceBox, pricePiece, discount, stock
    const productId = parseInt(parts[3]);

    const fieldMap = {
      'priceBox': 'Karobka narxi (faqat musbat son)',
      'pricePiece': 'Dona narxi (faqat musbat son)',
      'discount': 'Chegirma (0 dan 100 gacha son)',
      'stock': 'Stock (0 yoki musbat son)'
    };
    const fieldName = fieldMap[fieldType];

    if (!fieldName) {
      bot.answerCallbackQuery(callbackQuery.id, { text: "Noto'g'ri maydon!" });
      return;
    }

    userState[chatId] = { 
      step: 'update_value', 
      data: { 
        id: productId, 
        field: fieldType 
      } 
    };

    bot.editMessageText(`**${fieldName}** uchun yangi qiymatni yuboring:`, { 
      chat_id: chatId, 
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown'
    });
    bot.answerCallbackQuery(callbackQuery.id, { text: `${fieldName} tanlandi! Endi qiymat yuboring.` });
    return;
  }

  // --- Bekor qilish buyrug'i ---
  if (data === 'update_cancel') {
    userState[chatId] = { step: 'none' };
    bot.editMessageText("Yangilash bekor qilindi. Boshqa amalni tanlang.", { 
      chat_id: chatId, 
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown'
    });
    bot.answerCallbackQuery(callbackQuery.id, { text: "Bekor qilindi!" });
    return;
  }
});

console.log("Bot ishga tushdi va polling boshlandi...");