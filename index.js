// index.js

const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// 1. O'zingizning ma'lumotlaringiz bilan almashtiring
const TOKEN = '7586941333:AAHKly13Z3M5qkyKjP-6x-thWvXdJudIHsU';
const ADMIN_CHAT_ID = 7122472578; // Masalan: 123456789
const BOT_USERNAME = '@panjiyevdev_newsbot';

// Firebase ni sozlash (Service Account Key faylini ishlatish)
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // O'zingizning Realtime Database yoki Firestore URL manzilingizni qo'ying
  databaseURL: "https://oscar-d85af.firebaseio.com" 
});

// Firestore dan foydalanish (tavsiya etiladi)
const db = admin.firestore();

// Botni ishga tushirish
const bot = new TelegramBot(TOKEN, { polling: true });

// Foydalanuvchi holatlari (mahsulot qo'shish bosqichini saqlash uchun)
const userState = {};

// Asosiy buyruqlar
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

// --- Yordamchi Funksiyalar ---

/**
 * Mahsulot ID sini hisoblash: Eng katta ID + 1
 * @param {string} collectionName - 'products' yoki 'categories'
 * @returns {number} Yangi ID
 */
async function getNextId(collectionName) {
    const snapshot = await db.collection(collectionName).orderBy('id', 'desc').limit(1).get();
    if (snapshot.empty) {
        return 1;
    }
    const maxId = snapshot.docs[0].data().id;
    return maxId + 1;
}

// --- Telegram Bot Logikasi ---

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Faqat admin uchun ruxsat berish
    if (chatId != ADMIN_CHAT_ID) {
        bot.sendMessage(chatId, "Kechirasiz, sizda ushbu botni boshqarish huquqi yo'q.");
        return;
    }

    if (text === '/start') {
        userState[chatId] = { step: 'none' };
        bot.sendMessage(chatId, "Xush kelibsiz! Marhamat, kerakli amalni tanlang.", mainKeyboard);
        return;
    }

    // --- Mahsulot qo'shish bosqichlari ---
    if (text === "🛍 Mahsulot qo'shish") {
        const categoriesSnapshot = await db.collection('categories').get();
        const categoryNames = categoriesSnapshot.docs.map(doc => doc.data().name);

        if (categoryNames.length === 0) {
            bot.sendMessage(chatId, "Avval kategoriya qo'shing. /start ni bosing va '📂 Kategoriya qo'shish' tugmasini tanlang.");
            return;
        }

        userState[chatId] = {
            step: 'product_name',
            data: { categoryNames: categoryNames }
        };
        bot.sendMessage(chatId, "1/6. Mahsulot nomini kiriting:");
        return;
    }

    if (userState[chatId] && userState[chatId].step.startsWith('product_')) {
        const step = userState[chatId].step;
        const data = userState[chatId].data;

        switch (step) {
            case 'product_name':
                data.name = text;
                userState[chatId].step = 'product_price';
                bot.sendMessage(chatId, "2/6. Mahsulot narxini kiriting (faqat raqam, masalan: 49900):");
                break;

            case 'product_price':
                if (!/^\d+$/.test(text) || parseInt(text) <= 0) {
                    bot.sendMessage(chatId, "Noto'g'ri narx formati. Faqat musbat butun son kiriting:");
                    return;
                }
                data.price = parseInt(text);
                userState[chatId].step = 'product_discount';
                bot.sendMessage(chatId, "3/6. Chegirmani kiriting (raqam, masalan: 10). Chegirma bo'lmasa 0 kiriting:");
                break;

            case 'product_discount':
                if (!/^\d+$/.test(text) || parseInt(text) < 0 || parseInt(text) > 100) {
                    bot.sendMessage(chatId, "Noto'g'ri chegirma formati. 0 dan 100 gacha butun son kiriting:");
                    return;
                }
                data.discount = parseInt(text);
                userState[chatId].step = 'product_category';
                
                // Kategoriyalarni inline tugmalar qilib yuborish
                const categoryButtons = data.categoryNames.map(name => ({ text: name }));
                const categoryKeyboard = {
                    reply_markup: {
                        keyboard: [categoryButtons.map(btn => btn.text)],
                        resize_keyboard: true,
                        one_time_keyboard: true,
                    },
                };
                
                bot.sendMessage(chatId, "4/6. Kategoriyani tanlang:", categoryKeyboard);
                break;

            case 'product_category':
                if (!data.categoryNames.includes(text)) {
                    bot.sendMessage(chatId, "Bunday kategoriya mavjud emas. Yuqoridagi tugmalardan birini tanlang:");
                    return;
                }
                data.category = text;
                userState[chatId].step = 'product_image';
                bot.sendMessage(chatId, "5/6. Mahsulot rasmini kiriting (URL manzilini yuboring):");
                break;

            case 'product_image':
                // Oddiy URL validatsiyasi
                if (!text.startsWith('http')) {
                    bot.sendMessage(chatId, "Noto'g'ri URL manzili. Rasmning to'liq havolasini yuboring:");
                    return;
                }
                data.image = text;
                userState[chatId].step = 'product_description';
                bot.sendMessage(chatId, "6/6. Mahsulot haqida qisqacha ma'lumot (description) kiriting:");
                break;
            
            case 'product_description':
                data.description = text;
                
                // Finalizatsiya: Mahsulotni Firebase ga yozish
                const newId = await getNextId('products');
                const newProduct = {
                    id: newId,
                    name: data.name,
                    price: data.price,
                    discount: data.discount,
                    category: data.category,
                    image: data.image,
                    description: data.description,
                };

                try {
                    // ID ni hujjat ID si sifatida ishlatish (yoki Firestore'ning avtomatik ID'sidan foydalanish ham mumkin)
                    await db.collection('products').doc(String(newId)).set(newProduct);
                    bot.sendMessage(chatId, 
                        `✅ Mahsulot muvaffaqiyatli qo'shildi:\n\n` + 
                        `ID: ${newId}\n` + 
                        `Nomi: ${newProduct.name}\n` + 
                        `Narxi: ${newProduct.price.toLocaleString()} so'm`, 
                        mainKeyboard
                    );
                } catch (error) {
                    console.error("Mahsulot qo'shishda xato:", error);
                    bot.sendMessage(chatId, "❌ Mahsulotni Firebase ga yozishda xato yuz berdi.");
                }
                
                userState[chatId].step = 'none';
                break;
        }
        return;
    }


    // --- Kategoriya qo'shish bosqichlari ---
    if (text === "📂 Kategoriya qo'shish") {
        userState[chatId] = { step: 'category_name' };
        bot.sendMessage(chatId, "1/3. Kategoriya nomini kiriting (Masalan: Oziq-ovqat):");
        return;
    }

    if (userState[chatId] && userState[chatId].step.startsWith('category_')) {
        const step = userState[chatId].step;
        const data = userState[chatId].data || {};

        switch (step) {
            case 'category_name':
                data.name = text;
                userState[chatId].step = 'category_icon';
                userState[chatId].data = data;
                bot.sendMessage(chatId, "2/3. Kategoriya uchun ikonka (emoji) kiriting (Masalan: 🥄):");
                break;

            case 'category_icon':
                data.icon = text;
                userState[chatId].step = 'category_color';
                userState[chatId].data = data;
                bot.sendMessage(chatId, "3/3. Kategoriya rangini kiriting (Tailwind CSS klas nomlari, masalan: bg-green-500):");
                break;

            case 'category_color':
                data.color = text;
                
                // Finalizatsiya: Kategoriyani Firebase ga yozish
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
                        `✅ Kategoriya muvaffaqiyatli qo'shildi:\n\n` + 
                        `Nomi: ${newCategory.name}\n` + 
                        `Ikonka: ${newCategory.icon}\n` + 
                        `Rangi: ${newCategory.color}`, 
                        mainKeyboard
                    );
                } catch (error) {
                    console.error("Kategoriya qo'shishda xato:", error);
                    bot.sendMessage(chatId, "❌ Kategoriyani Firebase ga yozishda xato yuz berdi.");
                }

                userState[chatId].step = 'none';
                break;
        }
        return;
    }

    // --- Ma'lumotlarni ko'rish buyrug'i ---
    if (text === "📊 Ma'lumotlarni ko'rish") {
        try {
            const productsSnapshot = await db.collection('products').get();
            const categoriesSnapshot = await db.collection('categories').get();
            
            bot.sendMessage(chatId, 
                `📝 Hozirgi ma'lumotlar statistikasi:\n\n` + 
                `🔹 Mahsulotlar soni: ${productsSnapshot.size} ta\n` + 
                `🔹 Kategoriyalar soni: ${categoriesSnapshot.size} ta\n\n` +
                `Ma'lumotlar Firebase Cloud Firestore bazasida saqlanmoqda.`
            );
        } catch (error) {
            console.error("Ma'lumotlarni olishda xato:", error);
            bot.sendMessage(chatId, "❌ Firebase dan ma'lumotlarni olishda xato yuz berdi.");
        }
        return;
    }

    // Agar foydalanuvchi hech qaysi bosqichda bo'lmasa
    if (!userState[chatId] || userState[chatId].step === 'none') {
        bot.sendMessage(chatId, "Iltimos, pastdagi tugmalardan birini tanlang.", mainKeyboard);
    }
});

console.log("Telegram bot ishga tushdi...");