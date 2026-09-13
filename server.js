const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Datos iniciales
const INITIAL_DATA = {
  adminPassword: "admin123", // Clave de acceso para el organizador
  place: "Canchas La Redonda - Cancha 5",
  datetime: "Viernes 20:00 hs",
  totalCost: 30000,
  currency: "ARS",
  mpAccessToken: "", // Access Token de Mercado Pago (APP_USR-... o TEST-...)
  mpPaymentLink: "", // O Link de Pago de Mercado Pago (https://mpago.la/...)
  players: [
    { id: '1', name: 'Lucas', paid: false },
    { id: '2', name: 'Martín', paid: false },
    { id: '3', name: 'Nico', paid: false },
    { id: '4', name: 'Rodrigo', paid: false },
    { id: '5', name: 'Seba', paid: false },
    { id: '6', name: 'Facundo', paid: false },
    { id: '7', name: 'Joaquín', paid: false },
    { id: '8', name: 'Gonzalo', paid: false },
    { id: '9', name: 'Tomás', paid: false },
    { id: '10', name: 'Mateo', paid: false }
  ]
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed.adminPassword) parsed.adminPassword = "admin123";
      if (!parsed.currency) parsed.currency = "ARS";
      return parsed;
    }
  } catch (e) {
    console.error("Error al leer data.json:", e);
  }
  saveData(INITIAL_DATA);
  return INITIAL_DATA;
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error("Error al guardar data.json:", e);
  }
}

let matchData = loadData();

// Tokens de sesión de admin activos
let validAdminTokens = new Set();

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function checkAdminAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return validAdminTokens.has(token);
}

// Devuelve datos públicos sin exponer el token de admin ni secretos
function getPublicData() {
  const { adminPassword, mpAccessToken, ...safeData } = matchData;
  safeData.hasMercadoPagoToken = Boolean(matchData.mpAccessToken && matchData.mpAccessToken.trim().length > 10);
  safeData.hasPaymentLink = Boolean(matchData.mpPaymentLink && matchData.mpPaymentLink.trim().startsWith('http'));
  safeData.isReadyForRealPayments = safeData.hasMercadoPagoToken || safeData.hasPaymentLink;
  return safeData;
}

// Clientes SSE conectados
let sseClients = [];

function broadcastUpdate() {
  const payload = `data: ${JSON.stringify(getPublicData())}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(payload);
    } catch (e) {}
  });
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function getQuota() {
  const total = matchData.players.length;
  if (total === 0) return 0;
  return Math.ceil(matchData.totalCost / total);
}

// -------------------------------------------------------------
// COMUNICACIÓN CON LA API OFICIAL DE MERCADO PAGO
// -------------------------------------------------------------

// 1. Crear Preferencia de Pago en Mercado Pago
function createMercadoPagoPreference(player, host) {
  return new Promise((resolve, reject) => {
    const quota = getQuota();

    const preferencePayload = JSON.stringify({
      items: [
        {
          id: `cuota-${player.id}`,
          title: `Fútbol - Cuota de ${player.name}`,
          description: `Cuota para el partido en ${matchData.place} (${matchData.datetime})`,
          quantity: 1,
          currency_id: matchData.currency || 'ARS',
          unit_price: Number(quota)
        }
      ],
      payer: {
        name: player.name
      },
      external_reference: player.id,
      back_urls: {
        success: `http://${host}/payment/success?playerId=${player.id}`,
        failure: `http://${host}/payment/failure?playerId=${player.id}`,
        pending: `http://${host}/payment/pending?playerId=${player.id}`
      },
      auto_return: 'approved',
      statement_descriptor: 'FUTBOL CUOTA'
    });

    const options = {
      hostname: 'api.mercadopago.com',
      path: '/checkout/preferences',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${matchData.mpAccessToken.trim()}`
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            console.error('Respuesta de error de Mercado Pago:', parsed);
            reject(new Error(parsed.message || 'Error en Mercado Pago'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(preferencePayload);
    req.end();
  });
}

// 2. Verificar estado real de un pago con la API de Mercado Pago
function verifyMercadoPagoPayment(paymentId) {
  return new Promise((resolve, reject) => {
    if (!matchData.mpAccessToken) {
      return resolve(null);
    }

    const options = {
      hostname: 'api.mercadopago.com',
      path: `/v1/payments/${paymentId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${matchData.mpAccessToken.trim()}`
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. SSE Stream
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write(`data: ${JSON.stringify(getPublicData())}\n\n`);
    sseClients.push(res);

    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // 2. GET /api/match: Datos públicos
  if (pathname === '/api/match' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getPublicData()));
    return;
  }

  // 3. POST /api/create-preference: CREAR ORDEN EN MERCADO PAGO REAL
  if (pathname === '/api/create-preference' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { playerId } = JSON.parse(body);
        const player = matchData.players.find(p => p.id === playerId);
        if (!player) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Jugador no encontrado' }));
          return;
        }

        const host = req.headers.host || 'localhost:3000';

        // Caso A: El organizador tiene Access Token de Mercado Pago
        if (matchData.mpAccessToken && matchData.mpAccessToken.trim().length > 10) {
          try {
            const pref = await createMercadoPagoPreference(player, host);
            // Si es un token de prueba (TEST-...) usa sandbox_init_point, sino init_point
            const isTest = matchData.mpAccessToken.trim().startsWith('TEST-');
            const redirectUrl = (isTest && pref.sandbox_init_point) ? pref.sandbox_init_point : pref.init_point;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              mode: 'mercadopago_checkout',
              checkoutUrl: redirectUrl,
              preferenceId: pref.id
            }));
            return;
          } catch (mpError) {
            console.error('Error al generar Checkout en Mercado Pago:', mpError);
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'No se pudo conectar con Mercado Pago. Revisa tu Access Token en el panel de Admin.',
              details: mpError.message
            }));
            return;
          }
        }

        // Caso B: El organizador tiene un Link de Pago de Mercado Pago
        if (matchData.mpPaymentLink && matchData.mpPaymentLink.trim().startsWith('http')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            mode: 'payment_link',
            checkoutUrl: matchData.mpPaymentLink.trim()
          }));
          return;
        }

        // Caso C: El organizador no ha configurado Mercado Pago todavía
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          needsConfig: true,
          message: 'El organizador aún no ha conectado su cuenta de Mercado Pago para recibir dinero.'
        }));

      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return;
  }

  // 3b. POST /api/player/join: Auto-anotarse al partido (Público para amigos)
  if (pathname === '/api/player/join' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        const trimmed = (name || '').trim();
        if (!trimmed || trimmed.length < 2) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Escribe tu nombre para anotarte (mínimo 2 letras)' }));
          return;
        }

        // Evitar duplicados
        const exists = matchData.players.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
        if (exists) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Ya hay alguien anotado como "${trimmed}". Agrega tu apellido o apodo.` }));
          return;
        }

        const newPlayer = {
          id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 4),
          name: trimmed,
          paid: false
        };

        matchData.players.push(newPlayer);
        saveData(matchData);
        broadcastUpdate();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, player: newPlayer, matchData: getPublicData() }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return;
  }

  // 4. GET /payment/success: Retorno oficial de Mercado Pago
  if (pathname === '/payment/success' && req.method === 'GET') {
    const playerId = parsedUrl.searchParams.get('playerId') || parsedUrl.searchParams.get('external_reference');
    const paymentId = parsedUrl.searchParams.get('payment_id') || parsedUrl.searchParams.get('collection_id');
    const status = parsedUrl.searchParams.get('collection_status') || parsedUrl.searchParams.get('status');

    let isApproved = (status === 'approved');

    // Si tenemos paymentId y token, verificamos con la API de Mercado Pago
    if (paymentId && matchData.mpAccessToken) {
      try {
        const mpDetails = await verifyMercadoPagoPayment(paymentId);
        if (mpDetails && mpDetails.status === 'approved') {
          isApproved = true;
        }
      } catch (err) {
        console.warn('Verificación directa de MP falló, usando status de retorno:', err.message);
      }
    }

    if (isApproved && playerId) {
      const player = matchData.players.find(p => p.id === playerId);
      if (player) {
        player.paid = true;
        player.paidAt = new Date().toISOString();
        player.transactionId = paymentId ? `MP-${paymentId}` : `MP-${Date.now()}`;
        player.method = 'mercadopago_real';

        saveData(matchData);
        broadcastUpdate();
      }
    }

    res.writeHead(302, { 'Location': `/?paid=${isApproved ? 'success' : 'pending'}&player=${encodeURIComponent(playerId || '')}` });
    res.end();
    return;
  }

  // 5. GET /payment/failure: Pago rechazado o cancelado en Mercado Pago
  if (pathname === '/payment/failure' && req.method === 'GET') {
    res.writeHead(302, { 'Location': `/?paid=failure` });
    res.end();
    return;
  }

  // 6. GET /payment/pending: Pago pendiente en Mercado Pago
  if (pathname === '/payment/pending' && req.method === 'GET') {
    res.writeHead(302, { 'Location': `/?paid=pending` });
    res.end();
    return;
  }

  // 7. POST /api/webhook/mercadopago: Notificaciones IPN de Mercado Pago
  if (pathname === '/api/webhook/mercadopago' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const event = JSON.parse(body || '{}');
        const paymentId = event?.data?.id || parsedUrl.searchParams.get('data.id') || parsedUrl.searchParams.get('id');

        if (paymentId && matchData.mpAccessToken) {
          const payment = await verifyMercadoPagoPayment(paymentId);
          if (payment && payment.status === 'approved') {
            const playerId = payment.external_reference;
            const player = matchData.players.find(p => p.id === playerId);
            if (player) {
              player.paid = true;
              player.paidAt = new Date().toISOString();
              player.transactionId = `MP-${paymentId}`;
              player.method = 'mercadopago_real';
              saveData(matchData);
              broadcastUpdate();
            }
          }
        }
      } catch (e) {}
      res.writeHead(200);
      res.end('OK');
    });
    return;
  }

  // 8. POST /api/admin/login: Login de Administrador
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body);
        if (password === matchData.adminPassword) {
          const token = generateToken();
          validAdminTokens.add(token);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, token }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Contraseña incorrecta' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return;
  }

  // 9. POST /api/admin/match: Editar datos de cancha y costos (Admin)
  if (pathname === '/api/admin/match' && req.method === 'POST') {
    if (!checkAdminAuth(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        if (update.place !== undefined) matchData.place = update.place;
        if (update.datetime !== undefined) matchData.datetime = update.datetime;
        if (update.totalCost !== undefined) matchData.totalCost = Number(update.totalCost);

        saveData(matchData);
        broadcastUpdate();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, matchData: getPublicData() }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return;
  }

  // 10. POST /api/admin/mercadopago: Configurar credenciales reales de Mercado Pago (Admin)
  if (pathname === '/api/admin/mercadopago' && req.method === 'POST') {
    if (!checkAdminAuth(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { mpAccessToken, mpPaymentLink, currency } = JSON.parse(body);
        if (mpAccessToken !== undefined) matchData.mpAccessToken = mpAccessToken.trim();
        if (mpPaymentLink !== undefined) matchData.mpPaymentLink = mpPaymentLink.trim();
        if (currency !== undefined) matchData.currency = currency.trim() || 'ARS';

        saveData(matchData);
        broadcastUpdate();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Configuración de Mercado Pago guardada con éxito',
          matchData: getPublicData()
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return;
  }

  // 11. POST /api/admin/player: Gestionar jugadores (Admin)
  if (pathname === '/api/admin/player' && req.method === 'POST') {
    if (!checkAdminAuth(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { action, name, playerId, paid } = JSON.parse(body);

        if (action === 'add') {
          const trimmed = (name || '').trim();
          if (trimmed) {
            const newPlayer = {
              id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 4),
              name: trimmed,
              paid: false
            };
            matchData.players.push(newPlayer);
          }
        } else if (action === 'rename') {
          const p = matchData.players.find(pl => pl.id === playerId);
          if (p && name && name.trim()) {
            p.name = name.trim();
          }
        } else if (action === 'import') {
          if (Array.isArray(names)) {
            names.forEach(n => {
              const trimmed = (n || '').trim();
              if (trimmed) {
                matchData.players.push({
                  id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 4),
                  name: trimmed,
                  paid: false
                });
              }
            });
          }
        } else if (action === 'delete') {
          matchData.players = matchData.players.filter(p => p.id !== playerId);
        } else if (action === 'toggle-pay') {
          const p = matchData.players.find(pl => pl.id === playerId);
          if (p) {
            p.paid = (paid !== undefined) ? Boolean(paid) : !p.paid;
            if (p.paid) {
              p.paidAt = new Date().toISOString();
              p.method = 'manual_efectivo';
            } else {
              delete p.paidAt;
              delete p.transactionId;
              delete p.method;
            }
          }
        } else if (action === 'reset-payments') {
          matchData.players.forEach(p => {
            p.paid = false;
            delete p.paidAt;
            delete p.transactionId;
            delete p.method;
          });
        }

        saveData(matchData);
        broadcastUpdate();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, matchData: getPublicData() }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return;
  }

  // 12. POST /api/admin/password: Cambiar clave de admin
  if (pathname === '/api/admin/password' && req.method === 'POST') {
    if (!checkAdminAuth(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No autorizado' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { newPassword } = JSON.parse(body);
        if (newPassword && newPassword.trim().length >= 4) {
          matchData.adminPassword = newPassword.trim();
          saveData(matchData);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Clave cambiada' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'La contraseña debe tener al menos 4 caracteres' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON inválido' }));
      }
    });
    return;
  }

  // 13. Servir archivos estáticos
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(__dirname, reqPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Archivo no encontrado');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Error del servidor: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIp();
  console.log('====================================================');
  console.log('⚽ CanchaPago con Checkout Real de Mercado Pago');
  console.log('----------------------------------------------------');
  console.log(`🔐 Clave Administrador: admin123`);
  console.log(`💻 En tu PC: http://localhost:${PORT}`);
  console.log(`📱 En los celulares de tus amigos: http://${localIp}:${PORT}`);
  console.log('====================================================');
});
