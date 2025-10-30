// index.js

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios');
const FormData = require('form-data');

// Bot va Admin ma'lumotlari
const TOKEN = '7586941333:AAHKly13Z3M5qkyKjP-6x-thWvXdJudIHsU';
const admins = [5761225998, 7122472578]; // Admin chat ID
const IMGBB_API_KEY = '38fcdca0b624f0123f15491175c8bd78'; // ImgBB API key

// Firebase'ni sozlash (Railway uchun env var dan foydalanish)
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT env variable topilmadi! Railway'da qo\'shing.');
  process.exit(1);
}
const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString());

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

/**
 * Rasmni ImgBB'ga yuklash va URL qaytarish.
 * @param {string} fileId - Telegram file ID.
 * @returns {Promise<string|null>} - Yuklangan rasm URL yoki null (xato bo'lsa).
 */
async function uploadToImgBB(fileId) {
  try {
    // Telegram'dan file path olish
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;

    // File'ni download qilish (buffer)
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // FormData yaratish
    const form = new FormData();
    form.append('key', IMGBB_API_KEY);
    form.append('image', buffer, {
      filename: 'product_image.jpg',
      contentType: 'image/jpeg'
    });

    // ImgBB'ga yuklash
    const uploadResponse = await axios.post('https://api.imgbb.com/1/upload', form, {
      headers: {
        ...form.getHeaders()
      }
    });

    if (uploadResponse.data.success) {
      return uploadResponse.data.data.url; // To'liq URL
    } else {
      throw new Error('ImgBB yuklash muvaffaqiyatsiz');
    }
  } catch (error) {
    console.error('ImgBB yuklashda xato:', error);
    return null;
  }
}

// State'ni tozalash funksiyasi
function resetUserState(chatId) {
  userState[chatId] = { step: 'none', data: {} };
}

// Tugma buyruqlarini qayta ishlash funksiyasi
async function handleCommand(chatId, text) {
  // Har qanday buyruq oldin state'ni tozalaydi
  resetUserState(chatId);

  if (text === "🛍 Mahsulot qo'shish") {
    const categoriesSnapshot = await db.collection('categories').get();
    const categoryNames = categoriesSnapshot.docs.map(doc => doc.data().name);

    if (categoryNames.length === 0) {
      bot.sendMessage(chatId, "Avval kategoriya qo'shing. '📂 Kategoriya qo'shish' ni tanlang.", mainKeyboard);
      return;
    }

    userState[chatId] = { step: 'product_name', data: { categoryNames } };
    bot.sendMessage(chatId, "1/8. Mahsulot nomini kiriting:");
    return;
  }

  if (text === "📂 Kategoriya qo'shish") {
    userState[chatId] = { step: 'category_name', data: {} };
    bot.sendMessage(chatId, "1/2. Kategoriya nomini kiriting (mas: Oziq-ovqat):");
    return;
  }

  if (text === "💱 Dollar kursini o'rnatish") {
    userState[chatId] = { step: 'usd_rate' };
    bot.sendMessage(chatId, "USD to UZS kursini kiriting (masalan: 12600):");
    return;
  }

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

  // Agar hech qanday buyruq mos kelmasa
  bot.sendMessage(chatId, "Tushunmadim. Iltimos, quyidagi tugmalardan birini tanlang:", mainKeyboard);
}

// Asosiy message handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const photo = msg.photo; // Rasm uchun

  // Faqat admin uchun ruxsat
  if (!admins.includes(chatId)) {
    bot.sendMessage(chatId, "Bu bot faqat administratorlar uchun mo'ljallangan.");
    return;
  }

  // Agar photo bo'lsa, text'ni e'tiborsiz qoldirish
  if (photo && !text) {
    // Photo handler'ga o'tkazish
    return bot.emit('photo', msg);
  }

  // /start buyrug'i yoki / bilan boshlanadigan boshqa buyruqlar
  if (text && text.startsWith('/')) {
    if (text === '/start') {
      resetUserState(chatId);
      bot.sendMessage(chatId, "Xush kelibsiz! Admin paneliga kirish uchun tugmalardan birini tanlang.", mainKeyboard);
    } else {
      bot.sendMessage(chatId, "Noma'lum buyruq. /start ni bosing.", mainKeyboard);
    }
    return;
  }
  
  // Ma'lumot kirishni bekor qilish uchun umumiy funksiya
  if (text === "❌ Bekor qilish") {
      resetUserState(chatId);
      bot.sendMessage(chatId, "Joriy amal bekor qilindi.", mainKeyboard);
      return;
  }

  // Tugma buyruqlarini tekshirish (har doim reset qiladi)
  const commandButtons = [
    "🛍 Mahsulot qo'shish",
    "📂 Kategoriya qo'shish",
    "💱 Dollar kursini o'rnatish",
    "🔄 Mahsulotni yangilash",
    "📊 Ma'lumotlarni ko'rish"
  ];
  if (text && commandButtons.includes(text)) {
    await handleCommand(chatId, text);
    return;
  }

  // Joriy state'ni tekshirish
  if (!userState[chatId] || userState[chatId].step === 'none') {
    // Noma'lum buyruq
    bot.sendMessage(chatId, "Tushunmadim. Iltimos, quyidagi tugmalardan birini tanlang:", mainKeyboard);
    return;
  }

  // --- Mahsulot qo'shish bosqichlari ---
  if (userState[chatId] && userState[chatId].step.startsWith('product_')) {
    const step = userState[chatId].step;
    let data = userState[chatId].data;

    // / bilan boshlanadigan matnlarni nom sifatida qabul qilmaslik
    if (text && text.startsWith('/')) {
      bot.sendMessage(chatId, "Buyruq kiritildi. Joriy amalni davom ettirish uchun ma'lumot kiriting yoki ❌ Bekor qilish ni bosing.");
      return;
    }

    // Tugma buyruqlarini input sifatida qabul qilmaslik
    if (text && commandButtons.includes(text)) {
      bot.sendMessage(chatId, "Joriy amalni bekor qilish uchun ❌ Bekor qilish ni bosing yoki ma'lumot kiriting.");
      return;
    }

    switch (step) {
      case 'product_name':
        data.name = text;
        userState[chatId].step = 'product_price_box';
        bot.sendMessage(chatId, "2/8. Karobka narxi (raqam, mas: 200000):");
        break;

      case 'product_price_box':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Musbat son kiriting!");
          return;
        }
        data.priceBox = parseInt(text);
        userState[chatId].step = 'product_price_piece';
        bot.sendMessage(chatId, "3/8. Dona narxi (raqam, mas: 500):");
        break;

      case 'product_price_piece':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Musbat son kiriting!");
          return;
        }
        data.pricePiece = parseInt(text);
        userState[chatId].step = 'product_discount';
        bot.sendMessage(chatId, "4/8. Chegirma (0-100, mas: 10):");
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
        bot.sendMessage(chatId, "5/8. Kategoriyani tanlang:", categoryKeyboard);
        break;

      case 'product_category':
        if (!data.categoryNames.includes(text)) {
          bot.sendMessage(chatId, "Iltimos, kategoriyani tugmalardan tanlang!");
          return;
        }
        data.category = text;
        userState[chatId].step = 'product_image';
        bot.sendMessage(chatId, "6/8. Rasm yuboring (photo formatida):");
        break;

      case 'product_image':
        // Bu bosqichda text emas, photo kutish kerak. Shuning uchun bu yerda hech narsa qilmaymiz
        // Photo handler'da ishlov beriladi
        return;

      case 'product_description':
        data.description = text;
        userState[chatId].step = 'product_box_capacity';
        bot.sendMessage(chatId, "7/8. Har bir karobkada necha dona bor (raqam, mas: 20):");
        break;

      case 'product_box_capacity':
        if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
          bot.sendMessage(chatId, "Musbat son kiriting!");
          return;
        }
        data.boxCapacity = parseInt(text);
        userState[chatId].step = 'product_stock';
        bot.sendMessage(chatId, "8/8. Ombordagi jami stock (dona soni, mas: 100):");
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
            resetUserState(chatId);
            return;
        }
        
        const newProduct = {
          id: newId,
          name: data.name,
          priceBox: data.priceBox,
          pricePiece: data.pricePiece,
          discount: data.discount,
          category: data.category,
          image: data.image, // ImgBB'dan olingan URL
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

        resetUserState(chatId);
        break;
    }
    // data'ni har bir bosqichda yangilash
    userState[chatId].data = data;
    return;
  }

  // --- Kategoriya qo'shish bosqichlari ---
  if (userState[chatId] && userState[chatId].step.startsWith('category_')) {
    const step = userState[chatId].step;
    let data = userState[chatId].data;

    // / bilan boshlanadigan matnlarni nom sifatida qabul qilmaslik
    if (text && text.startsWith('/')) {
      bot.sendMessage(chatId, "Buyruq kiritildi. Joriy amalni davom ettirish uchun ma'lumot kiriting yoki ❌ Bekor qilish ni bosing.");
      return;
    }

    // Tugma buyruqlarini input sifatida qabul qilmaslik
    if (text && commandButtons.includes(text)) {
      bot.sendMessage(chatId, "Joriy amalni bekor qilish uchun ❌ Bekor qilish ni bosing yoki ma'lumot kiriting.");
      return;
    }

    switch (step) {
      case 'category_name':
        data.name = text;
        userState[chatId].step = 'category_icon';
        bot.sendMessage(chatId, "2/2. Ikonka (emoji, mas: 🥄):");
        break;

      case 'category_icon':
        data.icon = text;

        // Yangi kategoriyani saqlash
        const newId = await getNextId('categories');
        if (newId === -1) {
          bot.sendMessage(chatId, "❌ Kategoriya ID sini olishda xato yuz berdi!", mainKeyboard);
          resetUserState(chatId);
          return;
        }
        
        const newCategory = { id: newId, name: data.name, icon: data.icon };
        try {
          await db.collection('categories').doc(String(newId)).set(newCategory);
          bot.sendMessage(chatId, 
            `✅ Kategoriya **muvaffaqiyatli qo'shildi!**\n\n` +
            `**Nomi:** ${newCategory.name}\n` +
            `**Ikonka:** ${newCategory.icon}`, 
            mainKeyboard
          );
        } catch (error) {
          console.error("Kategoriya qo'shishda xato:", error);
          bot.sendMessage(chatId, "❌ Kategoriya qo'shishda xato yuz berdi!");
        }
        resetUserState(chatId);
        break;
    }
    userState[chatId].data = data;
    return;
  }

  // --- Dollar kursi o'rnatish bosqichi ---
  if (userState[chatId] && userState[chatId].step === 'usd_rate') {
    // / bilan boshlanadigan matnlarni qabul qilmaslik
    if (text && text.startsWith('/')) {
      bot.sendMessage(chatId, "Buyruq kiritildi. Joriy amalni davom ettirish uchun kurs kiriting yoki ❌ Bekor qilish ni bosing.");
      return;
    }

    // Tugma buyruqlarini input sifatida qabul qilmaslik
    if (text && commandButtons.includes(text)) {
      bot.sendMessage(chatId, "Joriy amalni bekor qilish uchun ❌ Bekor qilish ni bosing yoki kurs kiriting.");
      return;
    }

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
    resetUserState(chatId);
    return;
  }

  // --- Yangi qiymatni qabul qilish bosqichi (update_value) ---
  if (userState[chatId] && userState[chatId].step === 'update_value') {
    // / bilan boshlanadigan matnlarni qabul qilmaslik
    if (text && text.startsWith('/')) {
      bot.sendMessage(chatId, "Buyruq kiritildi. Joriy amalni davom ettirish uchun qiymat kiriting yoki ❌ Bekor qilish ni bosing.");
      return;
    }

    // Tugma buyruqlarini input sifatida qabul qilmaslik
    if (text && commandButtons.includes(text)) {
      bot.sendMessage(chatId, "Joriy amalni bekor qilish uchun ❌ Bekor qilish ni bosing yoki qiymat kiriting.");
      return;
    }

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
      resetUserState(chatId);
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

    resetUserState(chatId);
    return;
  }

  // Noma'lum holat
  bot.sendMessage(chatId, "Tushunmadim. Iltimos, quyidagi tugmalardan birini tanlang yoki ❌ Bekor qilish ni bosing:", mainKeyboard);
});

// Photo handler (rasm yuklash uchun)
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.photo[msg.photo.length - 1].file_id; // Eng yuqori sifatdagi rasm

  if (!admins.includes(chatId)) return;

  if (userState[chatId] && userState[chatId].step === 'product_image') {
    let data = userState[chatId].data;

    bot.sendMessage(chatId, "Rasm yuklanmoqda... ⏳");

    const imageUrl = await uploadToImgBB(fileId);
    if (imageUrl) {
      data.image = imageUrl;
      userState[chatId].step = 'product_description';
      bot.sendMessage(chatId, `✅ Rasm yuklandi: ${imageUrl}\n\n7/8. Tavsif (qisqa ma'lumot):`);
    } else {
      bot.sendMessage(chatId, "❌ Rasm yuklashda xato yuz berdi! Qaytadan urinib ko'ring.");
    }
    userState[chatId].data = data;
  } else {
    bot.sendMessage(chatId, "Hozir rasm kutilyapti emas. Tugmalardan foydalaning.");
  }
});

// Callback query handler (inline tugmalar uchun)
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  // Xavfsizlik tekshiruvi
  if (!data || !admins.includes(chatId)) {
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
    resetUserState(chatId);
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
