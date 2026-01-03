// === CONFIGURATION ===
const KV = COINS_KV_NAMESPACE; // bind KV USER_COIN di Worker
const MIDTRANS_SERVER_KEY = 'SB-Mid-server-CbLE5J6zwLT0AOSBn7SrLb7D';

// Helper: ambil data user
async function getUserCoins(userId) {
  let data = await KV.get(`user:${userId}:coins`);
  if (!data) return { totalCoins: 0, freeCoinsUsedToday: 0 };
  return JSON.parse(data);
}

// Helper: simpan data user
async function setUserCoins(userId, data) {
  await KV.put(`user:${userId}:coins`, JSON.stringify(data));
}

// === ROUTER SIMPLIFIED ===
async function router(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 1️⃣ Create Midtrans Payment
  if (path === '/coin/create-payment' && method === 'POST') {
    const { userId, packageCoins } = await request.json();

    const res = await fetch('https://app.sandbox.midtrans.com/snap/v1/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(MIDTRANS_SERVER_KEY + ':')
      },
      body: JSON.stringify({
        transaction_details: { order_id: `ORDER-${Date.now()}`, gross_amount: packageCoins * 1000 },
        customer_details: { first_name: userId }
      })
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  }

  // 2️⃣ Midtrans Webhook
  if (path === '/coin/midtrans-webhook' && method === 'POST') {
    const body = await request.text();
    const json = JSON.parse(body);
    const userId = json.customer_details.first_name;

    if (json.transaction_status === 'capture' || json.transaction_status === 'settlement') {
      let coins = await getUserCoins(userId);
      coins.totalCoins += parseInt(json.gross_amount / 1000);
      await setUserCoins(userId, coins);
    }

    return new Response('OK');
  }

  // 3️⃣ Create Task / Potong Coin
  if (path === '/task/create' && method === 'POST') {
    const { userId } = await request.json();
    let coins = await getUserCoins(userId);

    if (coins.totalCoins <= 0 && coins.freeCoinsUsedToday < 2) {
      coins.freeCoinsUsedToday += 1;
    } else if (coins.totalCoins > 0) {
      coins.totalCoins -= 1;
    } else {
      return new Response(JSON.stringify({ error: 'INSUFFICIENT_COIN' }), { status: 400 });
    }

    await setUserCoins(userId, coins);
    return new Response(JSON.stringify({ success: true, remainingCoins: coins.totalCoins, freeUsed: coins.freeCoinsUsedToday }), { status: 200 });
  }

  // 4️⃣ Check Status Coin
  if (path.startsWith('/coin/status/') && method === 'GET') {
    const userId = path.split('/').pop();
    const coins = await getUserCoins(userId);
    return new Response(JSON.stringify(coins), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response('Not found', { status: 404 });
}

// === SCHEDULED EVENT: Reset Free Coins Harian ===
addEventListener('scheduled', event => {
  event.waitUntil(resetFreeCoins());
});

async function resetFreeCoins() {
  const list = await KV.list({ prefix: 'user:' });
  for (const key of list.keys) {
    const data = JSON.parse(await KV.get(key.name));
    data.freeCoinsUsedToday = 0;
    await KV.put(key.name, JSON.stringify(data));
  }
}

// === FETCH EVENT ===
addEventListener('fetch', event => {
  event.respondWith(router(event.request));
});
