const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// --- SOZLAMALAR ---
// 1. O'zingizning ma'lumotlaringiz bilan almashtiring
const TOKEN = '7586941333:AAHKly13Z3M5qkyKjP-6x-thWvXdJudIHsU';
const ADMIN_CHAT_ID = 7122472578; // Faqat ushbu ID ga ruxsat beriladi
const BOT_USERNAME = '@panjiyevdev_newsbot';

// Firebase ni sozlash (Service Account Key faylini ishlatish)
// Eslatma: 'serviceAccountKey.json' fayli mavjudligiga ishonch hosil qiling
try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://oscar-d85af.firebaseio.com"
    });
} catch (error) {
    console.error("Firebase initilization error. Ensure serviceAccountKey.json is correct.", error);
    process.exit(1); // Xato bo'lsa to'xtatamiz
}

// Firestore dan foydalanish
const db = admin.firestore();

// Botni ishga tushirish
const bot = new TelegramBot(TOKEN, { polling: true });

// Foydalanuvchi holatlari
const userState = {};
// Zaxira darajasi
const LOW_STOCK_BOXES = 2;
const LOW_STOCK_UNITS = 10;

// Asosiy buyruqlar klaviaturasi
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: "🛍 Mahsulot qo'shish" }, { text: "📦 Mahsulotlarni boshqarish" }],
            [{ text: "📂 Kategoriya qo'shish" }, { text: "📊 Ma'lumotlarni ko'rish" }],
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
    // Firestore da max ID ni topish biroz murakkab. Avvalgi kod usulini saqlab qolamiz.
    const snapshot = await db.collection(collectionName).orderBy('id', 'desc').limit(1).get();
    if (snapshot.empty) {
        return 1;
    }
    const maxId = snapshot.docs[0].data().id;
    return (maxId || 0) + 1;
}

/**
 * Zaxira holatini tekshirish va adminni ogohlantirish
 * @param {string} productId - Mahsulot ID si
 * @param {string} productName - Mahsulot nomi
 * @param {number} stockBoxes - Karobka zaxirasi
 * @param {number} stockUnits - Dona zaxirasi
 */
async function checkLowStock(productId, productName, stockBoxes, stockUnits) {
    if (stockBoxes < LOW_STOCK_BOXES && stockUnits < LOW_STOCK_UNITS) {
        const message = `
⚠️ **DIQQAT! ZAXIRA KAM!** ⚠️
Mahsulot: **${productName}** (ID: ${productId})
Karobka qoldig'i: ${stockBoxes} ta
Dona qoldig'i: ${stockUnits} ta

Zudlik bilan yangilang!
        `;
        bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'Markdown' });
    }
}

// --- TELEGRAM BOT LOGIKASI ---

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Faqat admin uchun ruxsat berish
    if (chatId != ADMIN_CHAT_ID) {
        bot.sendMessage(chatId, "Kechirasiz, sizda ushbu botni boshqarish huquqi yo'q.");
        return;
    }

    // Holatni tozalash
    const clearState = () => {
        if (userState[chatId]) {
            userState[chatId].step = 'none';
            delete userState[chatId].data;
        }
    };
    
    // /start buyrug'i
    if (text === '/start' || text === 'Bekor qilish') {
        clearState();
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
        bot.sendMessage(chatId, "1/9. Mahsulot nomini kiriting:");
        return;
    }

    if (userState[chatId] && userState[chatId].step.startsWith('product_')) {
        const step = userState[chatId].step;
        const data = userState[chatId].data;

        const isNumeric = (val) => /^\d+$/.test(val) && parseInt(val) >= 0;

        switch (step) {
            case 'product_name':
                data.name = text;
                userState[chatId].step = 'product_price';
                bot.sendMessage(chatId, "2/9. Mahsulot **DONA** narxini kiriting (faqat raqam, masalan: 49900):");
                break;

            case 'product_price':
                if (!isNumeric(text) || parseInt(text) <= 0) {
                    bot.sendMessage(chatId, "Noto'g'ri narx formati. Faqat musbat butun son kiriting:");
                    return;
                }
                data.price = parseInt(text);
                userState[chatId].step = 'product_units_in_box';
                bot.sendMessage(chatId, "3/9. Bir **KAROBKA** da nechta **DONA** borligini kiriting (faqat raqam):");
                break;
            
            case 'product_units_in_box':
                if (!isNumeric(text) || parseInt(text) <= 0) {
                    bot.sendMessage(chatId, "Noto'g'ri miqdor formati. Faqat musbat butun son kiriting:");
                    return;
                }
                data.unitsInBox = parseInt(text);
                userState[chatId].step = 'product_stock_boxes';
                bot.sendMessage(chatId, "4/9. Boshlang'ich **KAROBKA** zaxirasini kiriting (faqat raqam, masalan: 50):");
                break;

            case 'product_stock_boxes':
                if (!isNumeric(text)) {
                    bot.sendMessage(chatId, "Noto'g'ri zaxira formati. Faqat butun son kiriting:");
                    return;
                }
                data.stockBoxes = parseInt(text);
                userState[chatId].step = 'product_stock_units';
                bot.sendMessage(chatId, "5/9. Boshlang'ich **DONA** zaxirasini kiriting (faqat raqam, masalan: 23):");
                break;

            case 'product_stock_units':
                if (!isNumeric(text)) {
                    bot.sendMessage(chatId, "Noto'g'ri zaxira formati. Faqat butun son kiriting:");
                    return;
                }
                data.stockUnits = parseInt(text);
                userState[chatId].step = 'product_discount';
                bot.sendMessage(chatId, "6/9. Chegirmani kiriting (raqam, masalan: 10). Chegirma bo'lmasa 0 kiriting:");
                break;

            case 'product_discount':
                if (!isNumeric(text) || parseInt(text) > 100) {
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
                
                bot.sendMessage(chatId, "7/9. Kategoriyani tanlang:", categoryKeyboard);
                break;

            case 'product_category':
                if (!data.categoryNames.includes(text)) {
                    bot.sendMessage(chatId, "Bunday kategoriya mavjud emas. Yuqoridagi tugmalardan birini tanlang:");
                    return;
                }
                data.category = text;
                userState[chatId].step = 'product_image';
                bot.sendMessage(chatId, "8/9. Mahsulot rasmini kiriting (URL manzilini yuboring):");
                break;

            case 'product_image':
                if (!text.startsWith('http')) {
                    bot.sendMessage(chatId, "Noto'g'ri URL manzili. Rasmning to'liq havolasini yuboring:");
                    return;
                }
                data.image = text;
                userState[chatId].step = 'product_description';
                bot.sendMessage(chatId, "9/9. Mahsulot haqida qisqacha ma'lumot (description) kiriting:");
                break;
            
            case 'product_description':
                data.description = text;
                
                // Finalizatsiya: Mahsulotni Firebase ga yozish
                const newId = await getNextId('products');
                const newProduct = {
                    id: newId,
                    name: data.name,
                    price: data.price,
                    unitsInBox: data.unitsInBox, // YANGI
                    stockBoxes: data.stockBoxes, // YANGI
                    stockUnits: data.stockUnits, // YANGI
                    discount: data.discount,
                    category: data.category,
                    image: data.image,
                    description: data.description,
                };

                try {
                    await db.collection('products').doc(String(newId)).set(newProduct);
                    bot.sendMessage(chatId, 
                        `✅ Mahsulot muvaffaqiyatli qo'shildi:\n\n` + 
                        `Nomi: ${newProduct.name}\n` + 
                        `Karobka/Dona: ${newProduct.unitsInBox} ta dona\n` +
                        `Boshlang'ich Zaxira: ${newProduct.stockBoxes} Karobka, ${newProduct.stockUnits} Dona`
                    , mainKeyboard);
                } catch (error) {
                    console.error("Mahsulot qo'shishda xato:", error);
                    bot.sendMessage(chatId, "❌ Mahsulotni Firebase ga yozishda xato yuz berdi.");
                }
                
                clearState();
                break;
        }
        return;
    }


    // --- Mahsulotlarni boshqarish (Ko'rish, O'chirish, Qoldiqni yangilash) ---
    if (text === "📦 Mahsulotlarni boshqarish") {
        try {
            const productsSnapshot = await db.collection('products').get();
            const products = productsSnapshot.docs.map(doc => ({ ...doc.data(), docId: doc.id }));

            if (products.length === 0) {
                bot.sendMessage(chatId, "Mahsulotlar topilmadi. Avval mahsulot qo'shing.");
                return;
            }

            let message = "📦 **Mahsulotlarni Boshqarish**\n\n";
            const inlineKeyboard = [];

            products.forEach(p => {
                message += `**ID: ${p.id} - ${p.name}**\n`;
                message += `Zaxira: ${p.stockBoxes} Karobka, ${p.stockUnits} Dona\n`;
                const boxPrice = (p.price * p.unitsInBox * (1 - p.discount / 100));
                message += `Karobka narxi: ${boxPrice.toLocaleString()} so'm\n`;
                message += `\n`;

                inlineKeyboard.push([
                    { text: `🗑 O'chirish (${p.id})`, callback_data: `delete_${p.id}` },
                    { text: `✍️ Qoldiqni yangilash (${p.id})`, callback_data: `update_stock_${p.id}` },
                ]);
            });

            const keyboard = {
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            };

            bot.sendMessage(chatId, message, { reply_markup: keyboard.reply_markup, parse_mode: 'Markdown' });

        } catch (error) {
            console.error("Mahsulotlarni boshqarishda xato:", error);
            bot.sendMessage(chatId, "❌ Mahsulotlarni olishda xato yuz berdi.");
        }
        return;
    }


    // --- Kategoriya qo'shish bosqichlari (O'zgartirishsiz) ---
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
                        `Nomi: ${newCategory.name}`, 
                        mainKeyboard
                    );
                } catch (error) {
                    console.error("Kategoriya qo'shishda xato:", error);
                    bot.sendMessage(chatId, "❌ Kategoriyani Firebase ga yozishda xato yuz berdi.");
                }

                clearState();
                break;
        }
        return;
    }
    
    // --- Ma'lumotlarni ko'rish buyrug'i (O'zgartirishsiz) ---
    if (text === "📊 Ma'lumotlarni ko'rish") {
        try {
            const productsSnapshot = await db.collection('products').get();
            const categoriesSnapshot = await db.collection('categories').get();
            
            const totalStock = productsSnapshot.docs.reduce((acc, doc) => {
                const data = doc.data();
                return acc + (data.stockBoxes || 0) + (data.stockUnits || 0) / (data.unitsInBox || 1);
            }, 0);

            bot.sendMessage(chatId, 
                `📝 Hozirgi ma'lumotlar statistikasi:\n\n` + 
                `🔹 Mahsulotlar soni: ${productsSnapshot.size} ta\n` + 
                `🔹 Kategoriyalar soni: ${categoriesSnapshot.size} ta\n` +
                `🔹 Umumiy taxminiy zaxira: ${totalStock.toFixed(2)} ta Karobka (ekvivalent)\n\n` +
                `Ma'lumotlar Firebase Cloud Firestore bazasida saqlanmoqda.`
            );
        } catch (error) {
            console.error("Ma'lumotlarni olishda xato:", error);
            bot.sendMessage(chatId, "❌ Firebase dan ma'lumotlarni olishda xato yuz berdi.");
        }
        return;
    }
    
    // --- Qoldiqni yangilash bosqichlari ---
    if (userState[chatId] && userState[chatId].step === 'awaiting_new_stock') {
        const data = userState[chatId].data;
        const [boxStr, unitStr] = text.split(',').map(s => s.trim());
        const newBoxes = parseInt(boxStr);
        const newUnits = parseInt(unitStr);
        
        const productId = data.productId;

        if (isNaN(newBoxes) || newBoxes < 0 || isNaN(newUnits) || newUnits < 0) {
            bot.sendMessage(chatId, "Noto'g'ri format. Iltimos, 'Karobka_soni, Dona_soni' formatida kiriting (masalan: 50, 23).");
            return;
        }

        try {
            await db.collection('products').doc(String(productId)).update({
                stockBoxes: newBoxes,
                stockUnits: newUnits,
            });
            
            // Zaxirani yangilagandan so'ng darhol tekshirish
            checkLowStock(productId, data.productName, newBoxes, newUnits);

            bot.sendMessage(chatId, 
                `✅ Mahsulot (ID: ${productId}) zaxirasi muvaffaqiyatli yangilandi:\n` +
                `Yangi zaxira: ${newBoxes} Karobka, ${newUnits} Dona`
            , mainKeyboard);

        } catch (error) {
            console.error("Zaxirani yangilashda xato:", error);
            bot.sendMessage(chatId, "❌ Zaxirani Firebase da yangilashda xato yuz berdi.");
        }

        clearState();
        return;
    }
});

// --- Inline tugma so'rovlarini boshqarish ---
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const data = callbackQuery.data;
    const parts = data.split('_');
    const action = parts[0];
    const productId = parts[1];

    await bot.answerCallbackQuery(callbackQuery.id); // Tugmani bosish animatsiyasini tugatish

    // Mahsulotni topish
    const productDoc = await db.collection('products').doc(String(productId)).get();
    if (!productDoc.exists) {
        bot.sendMessage(chatId, "❌ Mahsulot topilmadi.");
        return;
    }
    const productData = productDoc.data();
    
    // O'chirish amali
    if (action === 'delete') {
        try {
            await db.collection('products').doc(String(productId)).delete();
            bot.editMessageText(`🗑 Mahsulot (ID: ${productId} - ${productData.name}) muvaffaqiyatli o'chirildi.`, {
                chat_id: chatId,
                message_id: message.message_id
            });
            bot.sendMessage(chatId, "Asosiy menyuga qayting.", mainKeyboard);
        } catch (error) {
            console.error("Mahsulotni o'chirishda xato:", error);
            bot.sendMessage(chatId, "❌ Mahsulotni o'chirishda xato yuz berdi.");
        }
        return;
    }

    // Qoldiqni yangilash amali
    if (action === 'update' && parts[1] === 'stock') {
        // Zaxira yangilash bosqichini boshlash
        userState[chatId] = { 
            step: 'awaiting_new_stock', 
            data: { 
                productId: parseInt(productId),
                productName: productData.name
            } 
        };
        
        bot.sendMessage(chatId, 
            `**${productData.name}** mahsuloti uchun yangi zaxirani kiriting.\n` +
            `Hozirgi zaxira: ${productData.stockBoxes} Karobka, ${productData.stockUnits} Dona.\n\n` +
            `Format: **Karobka_soni, Dona_soni** (Masalan: 50, 23).`,
            {
                reply_markup: {
                    keyboard: [[{text: 'Bekor qilish'}]],
                    resize_keyboard: true,
                    one_time_keyboard: true,
                },
                parse_mode: 'Markdown'
            }
        );
        return;
    }
});

// Bot ishga tushganini bildirish
console.log("Telegram bot ishga tushdi...");
