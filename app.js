/**
 * CanchaPago ⚽ - Integración Oficial con Mercado Pago Checkout Pro
 */

let state = {
  place: "Canchas La Redonda - Cancha 5",
  datetime: "Viernes 20:00 hs",
  totalCost: 30000,
  discountFromPrevious: 0,
  reserveFund: 0,
  minPlayers: 14,
  fixedQuota: 0,
  forcePaymentsOpen: false,
  paymentsUnlocked: false,
  currency: "ARS",
  hasMercadoPagoToken: false,
  hasPaymentLink: false,
  isReadyForRealPayments: false,
  players: [],
  currentFilter: "all"
};

let adminToken = sessionStorage.getItem('cancha_admin_token') || null;
let isAdmin = Boolean(adminToken);

// Jugador actual a pagar y checkout URL generado
let currentPayingPlayer = null;
let currentCheckoutUrl = null;
let sseSource = null;

// -------------------------------------------------------------
// INICIALIZACIÓN
// -------------------------------------------------------------
function initApp() {
  updateAdminUI();
  initSync();
  setupEventListeners();

  // Comprobar si volvemos de pagar en Mercado Pago
  checkMercadoPagoReturn();
}

function checkMercadoPagoReturn() {
  const urlParams = new URLSearchParams(window.location.search);
  const paidStatus = urlParams.get('paid');

  if (paidStatus === 'success') {
    showToast('¡Pago aprobado por Mercado Pago con éxito! Tu cuota quedó en verde 🟢', '🏆');
    fireConfetti();
    playSound('goal');
    // Limpiar URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (paidStatus === 'failure') {
    showToast('El pago fue cancelado o rechazado por Mercado Pago 🔴', '❌');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (paidStatus === 'pending') {
    showToast('El pago se encuentra pendiente de acreditación en Mercado Pago ⏳', '⏳');
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

function initSync() {
  if (window.EventSource) {
    try {
      sseSource = new EventSource('/api/events');

      sseSource.onopen = () => updateLiveIndicator(true);

      sseSource.onmessage = (event) => {
        try {
          const remoteData = JSON.parse(event.data);
          applyRemoteData(remoteData);
        } catch (e) {}
      };

      sseSource.onerror = () => updateLiveIndicator(false);
    } catch (e) {}
  }

  fetch('/api/match')
    .then(r => r.json())
    .then(data => {
      applyRemoteData(data);
      updateLiveIndicator(true);
    })
    .catch(() => updateLiveIndicator(false));
}

function updateLiveIndicator(online) {
  const indicator = document.getElementById('live-indicator');
  if (indicator) {
    indicator.textContent = online ? 'Sincronizado en vivo' : 'Conectando...';
    indicator.parentElement.classList.toggle('text-emerald-400', online);
    indicator.parentElement.classList.toggle('text-amber-400', !online);
  }
}

function applyRemoteData(remoteData) {
  if (!remoteData) return;

  const prevCollected = calculateMetrics(state).collected;

  state.place = remoteData.place || state.place;
  state.datetime = remoteData.datetime || state.datetime;
  state.totalCost = remoteData.totalCost !== undefined ? remoteData.totalCost : state.totalCost;
  state.minPlayers = remoteData.minPlayers !== undefined ? Number(remoteData.minPlayers) : (state.minPlayers || 14);
  state.fixedQuota = remoteData.fixedQuota !== undefined ? Number(remoteData.fixedQuota) : (state.fixedQuota || 0);
  state.discountFromPrevious = remoteData.discountFromPrevious !== undefined ? Number(remoteData.discountFromPrevious) : 0;
  state.reserveFund = remoteData.reserveFund !== undefined ? Number(remoteData.reserveFund) : 0;
  state.currency = remoteData.currency || 'ARS';
  state.mpPaymentLink = remoteData.mpPaymentLink || state.mpPaymentLink || '';
  state.forcePaymentsOpen = Boolean(remoteData.forcePaymentsOpen);
  state.hasMercadoPagoToken = Boolean(remoteData.hasMercadoPagoToken);
  state.hasPaymentLink = Boolean(remoteData.hasPaymentLink);
  state.isReadyForRealPayments = Boolean(remoteData.isReadyForRealPayments);
  state.players = Array.isArray(remoteData.players) ? remoteData.players : state.players;

  const minReq = state.minPlayers || 14;
  const prevUnlocked = state.paymentsUnlocked;
  state.paymentsUnlocked = (state.players.length >= minReq) || state.forcePaymentsOpen;

  // Celebración cuando se llega a los 14 y se desbloquean los cobros
  if (!prevUnlocked && state.paymentsUnlocked && state.players.length >= minReq) {
    fireConfetti();
    playSound('goal');
    showToast('🎉 ¡14 jugadores inscritos! Casillas de pago habilitadas', '⚽');
  }

  const newMetrics = calculateMetrics(state);

  // Festejo si se alcanza el 100% de recaudación
  if (newMetrics.percent >= 100 && state.totalCost > 0 && prevCollected < state.totalCost) {
    fireConfetti();
    playSound('goal');
    showToast('¡Cancha pagada al 100%! 🎉⚽', '🏆');
  }

  render();
}

// -------------------------------------------------------------
// ESTADO Y UI DE ADMINISTRADOR
// -------------------------------------------------------------
function updateAdminUI() {
  isAdmin = Boolean(adminToken);
  const guestView = document.getElementById('admin-guest-view');
  const loggedView = document.getElementById('admin-logged-view');
  const toolbar = document.getElementById('admin-toolbar');

  if (isAdmin) {
    guestView.classList.add('hidden');
    loggedView.classList.remove('hidden');
    toolbar.classList.remove('hidden');
  } else {
    guestView.classList.remove('hidden');
    loggedView.classList.add('hidden');
    toolbar.classList.add('hidden');
  }
}

function adminLogout() {
  adminToken = null;
  sessionStorage.removeItem('cancha_admin_token');
  updateAdminUI();
  showToast('Sesión de Administrador cerrada', '👋');
  render();
}

function adminFetch(url, options = {}) {
  options.headers = options.headers || {};
  if (adminToken) {
    options.headers['Authorization'] = `Bearer ${adminToken}`;
  }
  options.headers['Content-Type'] = 'application/json';
  return fetch(url, options);
}

// -------------------------------------------------------------
// AUDIO Y ANIMACIONES
// -------------------------------------------------------------
let audioCtx = null;
function playSound(type) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx && AudioContextClass) audioCtx = new AudioContextClass();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (!audioCtx) return;

    const ctx = audioCtx;
    const now = ctx.currentTime;

    if (type === 'paid') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.14);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.24);
    } else if (type === 'goal') {
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.15, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.08 + 0.25);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.28);
      });
    }
  } catch (e) {}
}

function fireConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.65 },
      colors: ['#009ee3', '#10b981', '#34d399', '#facc15', '#ffffff']
    });
  }
}

// -------------------------------------------------------------
// CÁLCULOS
// -------------------------------------------------------------
function formatCurrency(amount) {
  return '$' + Math.round(amount).toLocaleString('es-AR');
}

function calculateMetrics(st) {
  const minPlayers = Math.max(1, Number(st.minPlayers) || 14);
  const totalPlayers = st.players.length;
  const discountFromPrevious = Number(st.discountFromPrevious) || 0;
  const netCost = Math.max(0, (Number(st.totalCost) || 0) - discountFromPrevious);

  let quota = 0;
  if (st.fixedQuota && Number(st.fixedQuota) > 0) {
    quota = Number(st.fixedQuota);
  } else {
    // La cuota de los titulares siempre se divide entre los 14 requeridos
    quota = minPlayers > 0 ? Math.ceil(netCost / minPlayers) : 0;
  }

  const starters = st.players.slice(0, minPlayers);
  const bench = st.players.slice(minPlayers);

  const startersPaid = starters.filter(p => p.paid);
  const benchPaid = bench.filter(p => p.paid);

  const startersPaidCount = startersPaid.length;
  const benchPaidCount = benchPaid.length;
  const paidCount = startersPaidCount + benchPaidCount;
  const pendingCount = totalPlayers - paidCount;

  // Recaudación para pagar la cancha actual
  const collectedForCourt = startersPaid.reduce((sum, p) => sum + (Number(p.paidAmount) || quota), 0);
  const remaining = Math.max(0, netCost - collectedForCourt);

  // Fondo de reserva acumulado por suplentes (jugadores 15, 16, etc. que pagaron)
  const dynamicReserve = benchPaid.reduce((sum, p) => sum + (Number(p.paidAmount) || quota), 0);
  const reserveFund = Math.max(dynamicReserve, Number(st.reserveFund) || 0);

  const surplus = Math.max(0, collectedForCourt - netCost);
  const percent = netCost > 0 ? Math.min(100, Math.round((collectedForCourt / netCost) * 100)) : 0;

  const startersCount = Math.min(totalPlayers, minPlayers);
  const startersNeeded = Math.max(0, minPlayers - totalPlayers);
  const benchCount = Math.max(0, totalPlayers - minPlayers);

  return {
    quota,
    netCost,
    discountFromPrevious,
    reserveFund,
    totalPlayers,
    paidCount,
    pendingCount,
    startersPaidCount,
    benchPaidCount,
    collected: collectedForCourt,
    remaining,
    surplus,
    percent,
    minPlayers,
    startersCount,
    startersNeeded,
    benchCount
  };
}

// -------------------------------------------------------------
// RENDERIZADO VISUAL
// -------------------------------------------------------------
function render() {
  const metrics = calculateMetrics(state);

  document.getElementById('hero-place').textContent = state.place || 'Cancha a confirmar';
  document.getElementById('hero-datetime').textContent = state.datetime || 'Horario a confirmar';
  document.getElementById('hero-quota').textContent = formatCurrency(metrics.quota);

  // Banner de Descuento aplicado por reserva previa
  const discountBanner = document.getElementById('hero-discount-banner');
  const discountAmount = document.getElementById('hero-discount-amount');
  const discountDesc = document.getElementById('hero-discount-desc');
  if (discountBanner && discountAmount) {
    if (metrics.discountFromPrevious > 0) {
      discountBanner.classList.remove('hidden');
      discountAmount.textContent = `-${formatCurrency(metrics.discountFromPrevious)}`;
      if (discountDesc) {
        discountDesc.textContent = `Costo cancha ${formatCurrency(state.totalCost)} - Descuento reserva ${formatCurrency(metrics.discountFromPrevious)} = Neto ${formatCurrency(metrics.netCost)}`;
      }
    } else {
      discountBanner.classList.add('hidden');
    }
  }

  // Detalle bajo la cuota
  const heroDivisionDetail = document.getElementById('hero-division-detail');
  if (heroDivisionDetail) {
    if (state.fixedQuota && Number(state.fixedQuota) > 0) {
      heroDivisionDetail.textContent = 'Cuota fija personalizada';
    } else if (metrics.discountFromPrevious > 0) {
      heroDivisionDetail.textContent = `(${formatCurrency(metrics.netCost)} neto ÷ ${metrics.minPlayers} titulares)`;
    } else {
      heroDivisionDetail.textContent = `(${formatCurrency(state.totalCost)} total ÷ ${metrics.minPlayers} titulares)`;
    }
  }

  const heroMinPlayers = document.getElementById('hero-min-players');
  if (heroMinPlayers) {
    heroMinPlayers.textContent = `${metrics.minPlayers} jugadores`;
  }

  const heroTeamStatus = document.getElementById('hero-team-status');
  const heroBenchBadge = document.getElementById('hero-bench-badge');
  if (heroTeamStatus) {
    if (metrics.startersNeeded > 0) {
      heroTeamStatus.className = 'flex items-center gap-1.5 text-amber-400 font-semibold';
      heroTeamStatus.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 shrink-0"></i><span>Faltan <strong>${metrics.startersNeeded}</strong> para los ${metrics.minPlayers} titulares (van ${metrics.totalPlayers}/${metrics.minPlayers})</span>`;
      if (heroBenchBadge) heroBenchBadge.classList.add('hidden');
    } else {
      heroTeamStatus.className = 'flex items-center gap-1.5 text-emerald-400 font-semibold';
      heroTeamStatus.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 shrink-0"></i><span>¡${metrics.minPlayers} Titulares completos!</span>`;
      if (heroBenchBadge) {
        if (metrics.benchCount > 0) {
          heroBenchBadge.textContent = `+${metrics.benchCount} en banca`;
          heroBenchBadge.classList.remove('hidden');
        } else {
          heroBenchBadge.classList.add('hidden');
        }
      }
    }
  }

  // Banner Fondo de Reserva Acumulado para Próximo Partido
  const reserveBanner = document.getElementById('hero-reserve-banner');
  const reserveAmount = document.getElementById('hero-reserve-amount');
  const reserveCount = document.getElementById('hero-reserve-count');
  if (reserveBanner && reserveAmount) {
    if (metrics.reserveFund > 0) {
      reserveBanner.classList.remove('hidden');
      reserveAmount.textContent = `+${formatCurrency(metrics.reserveFund)}`;
      if (reserveCount) {
        reserveCount.textContent = `${metrics.benchPaidCount} ${metrics.benchPaidCount === 1 ? 'suplente pagó' : 'suplentes pagaron'} (se restará automáticamente del próximo partido)`;
      }
    } else {
      reserveBanner.classList.add('hidden');
    }
  }

  const surplusContainer = document.getElementById('hero-surplus-container');
  const surplusAmount = document.getElementById('hero-surplus-amount');
  if (surplusContainer && surplusAmount) {
    if (metrics.surplus > 0) {
      surplusContainer.classList.remove('hidden');
      surplusAmount.textContent = `+${formatCurrency(metrics.surplus)}`;
    } else {
      surplusContainer.classList.add('hidden');
    }
  }

  document.getElementById('hero-progress-text').textContent = `${metrics.startersPaidCount} de ${metrics.startersCount} titulares pagaron`;
  document.getElementById('hero-remaining-text').textContent = metrics.remaining > 0 
    ? `Falta ${formatCurrency(metrics.remaining)}` 
    : '¡Cancha 100% Pagada! 🎉';

  const progressBar = document.getElementById('hero-progress-bar');
  progressBar.style.width = metrics.percent + '%';
  if (metrics.percent >= 100 && metrics.netCost > 0) {
    progressBar.classList.add('pulse-complete');
  } else {
    progressBar.classList.remove('pulse-complete');
  }

  document.getElementById('count-total').textContent = metrics.totalPlayers;
  document.getElementById('count-pending').textContent = metrics.pendingCount;
  document.getElementById('count-paid').textContent = metrics.paidCount;

  // Actualizar banner dinámico de bloqueo/desbloqueo de pagos
  const lockBanner = document.getElementById('payments-lock-banner');
  const lockIcon = document.getElementById('lock-banner-icon');
  const lockTitle = document.getElementById('lock-banner-title');
  const lockText = document.getElementById('lock-banner-text');

  if (lockBanner) {
    if (state.paymentsUnlocked) {
      lockBanner.className = 'bg-emerald-950/40 border border-emerald-800/60 rounded-2xl p-3 text-xs text-emerald-200 flex items-center gap-3 shadow-md';
      if (lockIcon) lockIcon.textContent = '⚽';
      if (lockTitle) lockTitle.textContent = '¡14 jugadores completados! Pagos habilitados:';
      if (lockText) lockText.innerHTML = `La convocatoria llegó a la meta. Toca tu botón para pagar la cuota de <strong>${formatCurrency(metrics.quota)}</strong> por Mercado Pago 🟢.`;
    } else {
      lockBanner.className = 'bg-amber-950/40 border border-amber-800/60 rounded-2xl p-3 text-xs text-amber-200 flex items-center gap-3';
      if (lockIcon) lockIcon.textContent = '🔒';
      if (lockTitle) lockTitle.textContent = `Cobros pausados hasta completar ${metrics.minPlayers} jugadores:`;
      if (lockText) lockText.innerHTML = `Para que nadie pague de más, los cobros se activarán cuando seamos <strong>${metrics.minPlayers} inscritos</strong> (van <span class="font-bold text-amber-300">${metrics.totalPlayers}</span> de ${metrics.minPlayers}).`;
    }
  }

  const labelForcePay = document.getElementById('label-admin-force-pay');
  if (labelForcePay) {
    labelForcePay.textContent = state.paymentsUnlocked ? 'Pausar Cobros' : 'Habilitar Cobros';
  }

  renderPlayers(metrics);

  if (window.lucide) {
    lucide.createIcons();
  }
}

function renderPlayers(metrics) {
  const container = document.getElementById('players-list');
  if (!container) return;

  const quota = metrics.quota;
  const minPlayers = metrics.minPlayers;

  let filtered = state.players;
  if (state.currentFilter === 'pending') {
    filtered = state.players.filter(p => !p.paid);
  } else if (state.currentFilter === 'paid') {
    filtered = state.players.filter(p => p.paid);
  }

  if (state.players.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 px-4 bg-[#121a24] rounded-2xl border border-dashed border-slate-800 space-y-1.5">
        <span class="text-2xl block">⚽</span>
        <h4 class="text-sm font-bold text-white">Aún no hay nadie anotado</h4>
        <p class="text-xs text-slate-400 max-w-xs mx-auto">Escribe tu nombre en la caja de arriba y sé el primero en sumarte al partido.</p>
      </div>
    `;
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 text-xs text-slate-500 bg-[#121a24] rounded-2xl border border-slate-800">
        No hay amigos en este filtro.
      </div>
    `;
    return;
  }

  let html = '';
  let showedBenchHeader = false;

  filtered.forEach((p, idx) => {
    // Posición original en state.players
    const originalIndex = state.players.findIndex(x => x.id === p.id);
    const isStarter = originalIndex < minPlayers;
    const isPaid = p.paid;
    const initial = (p.name || '?').charAt(0).toUpperCase();

    // Separador de banca cuando mostramos 'Todos'
    if (!isStarter && !showedBenchHeader && state.currentFilter === 'all') {
      showedBenchHeader = true;
      html += `
        <div class="pt-4 pb-2 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-sm">🪑</span>
            <span class="text-xs font-bold text-amber-400 uppercase tracking-wider">En Banca / Suplentes</span>
          </div>
          <span class="text-[10px] text-slate-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded-lg">Entran si se baja un titular</span>
        </div>
      `;
    }

    const badgeRole = isStarter 
      ? `<span class="text-[10px] text-emerald-400 font-semibold bg-emerald-950/70 border border-emerald-800/60 px-1.5 py-0.5 rounded">Titular #${originalIndex + 1}</span>`
      : (isPaid 
          ? `<span class="text-[10px] text-blue-300 font-semibold bg-blue-950/80 border border-blue-700/60 px-1.5 py-0.5 rounded flex items-center gap-1"><span>🎟️</span><span>Banca #${originalIndex - minPlayers + 1} (Reserva Próxima Fecha)</span></span>`
          : `<span class="text-[10px] text-amber-400 font-semibold bg-amber-950/70 border border-amber-800/60 px-1.5 py-0.5 rounded">Banca #${originalIndex - minPlayers + 1}</span>`);

    const statusText = isStarter
      ? (isPaid ? 'Pagado ' + formatCurrency(quota) : 'Debe ' + formatCurrency(quota))
      : (isPaid ? 'Pagado ' + formatCurrency(quota) + ' (Fondo de Reserva)' : 'Cuota ' + formatCurrency(quota) + ' (Fondo Reserva)');

    const statusColor = isPaid 
      ? (isStarter ? 'text-emerald-400 font-medium' : 'text-blue-400 font-medium')
      : (isStarter ? 'text-rose-400 font-medium' : 'text-amber-400/90 font-medium');

    html += `
      <div class="player-row bg-[#121a24] border ${isStarter ? 'border-slate-800/90' : (isPaid ? 'border-blue-900/60 bg-gradient-to-r from-[#121a24] to-[#121c2b]' : 'border-amber-900/50 bg-gradient-to-r from-[#121a24] to-[#1a1713]')} rounded-2xl p-3 flex items-center justify-between gap-3 shadow-sm">
        
        <!-- Avatar y Nombre -->
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <div class="w-9 h-9 rounded-xl ${isPaid ? (isStarter ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-blue-500/15 text-blue-400 border border-blue-500/30') : (isStarter ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-amber-950/50 text-amber-300 border border-amber-800/40')} flex items-center justify-center font-bold text-xs shrink-0">
            ${isPaid ? (isStarter ? '✓' : '🎟️') : initial}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-sm text-white truncate">${escapeHtml(p.name)}</span>
              ${badgeRole}
              ${p.transactionId ? `<span class="text-[9px] font-mono text-emerald-400 hidden sm:inline">#${p.transactionId}</span>` : ''}
            </div>
            <span class="text-[11px] ${statusColor}">
              ${statusText}
            </span>
          </div>
        </div>

        <!-- Botón de Pago Rojo / Verde / Azul Reserva / Bloqueado -->
        <div class="flex items-center gap-1.5 shrink-0">
          
          ${isPaid ? (
            isStarter ? `
              <!-- BOTÓN VERDE (TITULAR PAGADO) -->
              <div class="badge-paid px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 select-none" title="Pago aprobado por Mercado Pago">
                <span>PAGADO</span>
                <i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i>
              </div>
            ` : `
              <!-- BOTÓN AZUL (SUPLENTE PAGÓ RESERVA PARA PRÓXIMO PARTIDO) -->
              <div class="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 select-none bg-blue-500/20 text-blue-300 border border-blue-500/40" title="Pago acumulado en el Fondo de Reserva para el próximo partido">
                <span>RESERVA PAGADA</span>
                <i data-lucide="shield-check" class="w-3.5 h-3.5"></i>
              </div>
            `
          ) : (state.paymentsUnlocked ? `
            <!-- BOTÓN ROJO HABILITADO (ABRE MODAL DE MERCADO PAGO OFICIAL) -->
            <button 
              onclick="openPayModal('${p.id}')" 
              class="btn-action-pay px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-95 shadow-md shadow-red-500/20"
              title="${isStarter ? 'Pagar cuota de ' + escapeHtml(p.name) : 'Pagar cuota de reserva de ' + escapeHtml(p.name)}"
            >
              <i data-lucide="credit-card" class="w-3.5 h-3.5"></i>
              <span>Pagar ${formatCurrency(quota)} ${isStarter ? '' : '🎟️'}</span>
            </button>
          ` : `
            <!-- BOTÓN BLOQUEADO HASTA COMPLETAR 14 JUGADORES -->
            <button 
              onclick="alertPaymentsLocked()" 
              class="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-800 text-slate-400 border border-slate-700/80 hover:border-amber-500/40 hover:text-amber-300 transition flex items-center gap-1.5 active:scale-95"
              title="Los cobros se activarán cuando seamos 14 jugadores"
            >
              <i data-lucide="lock" class="w-3.5 h-3.5 text-amber-400"></i>
              <span>Esperando 14 (${state.players.length}/${minPlayers})</span>
            </button>
          `)}

          <!-- CONTROLES EXCLUSIVOS DE ADMINISTRADOR -->
          ${isAdmin ? `
            <div class="flex items-center gap-1 pl-1.5 border-l border-slate-800 ml-1">
              <!-- Botón renombrar nombre de amigo -->
              <button 
                onclick="adminRenamePlayer('${p.id}', '${escapeHtml(p.name)}')" 
                title="Editar nombre del amigo" 
                class="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-800 transition"
              >
                <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
              </button>

              <!-- Botón marcar/desmarcar pago en efectivo -->
              <button 
                onclick="adminTogglePay('${p.id}', ${!isPaid})"
                title="${isPaid ? 'Desmarcar pago (Admin)' : 'Marcar como pagado en efectivo (Admin)'}" 
                class="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition"
              >
                <i data-lucide="${isPaid ? 'rotate-ccw' : 'check'}" class="w-3.5 h-3.5"></i>
              </button>

              <!-- Botón eliminar amigo de la lista -->
              <button 
                onclick="adminDeletePlayer('${p.id}')" 
                title="Eliminar amigo de la lista"
                class="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition"
              >
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          ` : ''}

        </div>

      </div>
    `;
  });

  container.innerHTML = html;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.innerText = str;
  return d.innerHTML;
}

// -------------------------------------------------------------
// FLUJO DE PAGO: MERCADO PAGO OFICIAL
// -------------------------------------------------------------
window.alertPaymentsLocked = function() {
  const minReq = state.minPlayers || 14;
  const count = state.players.length;
  const missing = Math.max(0, minReq - count);
  showToast(`🔒 Faltan ${missing} jugadores para habilitar pagos (van ${count} de ${minReq})`, '⏳');
};

window.openPayModal = async function(playerId) {
  if (!state.paymentsUnlocked) {
    alertPaymentsLocked();
    return;
  }

  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  currentPayingPlayer = player;
  currentCheckoutUrl = null;
  const metrics = calculateMetrics(state);

  document.getElementById('modal-pay-player-name').textContent = player.name;
  document.getElementById('modal-pay-amount').textContent = formatCurrency(metrics.quota);
  document.getElementById('modal-pay-place').textContent = state.place;

  // Estados visuales del modal
  const boxLoading = document.getElementById('box-mp-loading');
  const boxReady = document.getElementById('box-mp-ready');
  const boxNotConfigured = document.getElementById('box-mp-not-configured');

  boxLoading.classList.remove('hidden');
  boxReady.classList.add('hidden');
  boxNotConfigured.classList.add('hidden');

  const modal = document.getElementById('modal-pay');
  modal.classList.remove('hidden');

  if (window.lucide) lucide.createIcons();

  // Pedir preferencia oficial al backend
  try {
    const res = await fetch('/api/create-preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id })
    });
    const data = await res.json();

    boxLoading.classList.add('hidden');

    if (data.success && data.checkoutUrl) {
      currentCheckoutUrl = data.checkoutUrl;
      boxReady.classList.remove('hidden');
    } else {
      // Falta configurar Mercado Pago
      boxNotConfigured.classList.remove('hidden');
    }
  } catch (err) {
    boxLoading.classList.add('hidden');
    boxNotConfigured.classList.remove('hidden');
  }
};

function closePayModal() {
  document.getElementById('modal-pay').classList.add('hidden');
  currentPayingPlayer = null;
  currentCheckoutUrl = null;
}

// -------------------------------------------------------------
// FUNCIONES DE ADMINISTRADOR
// -------------------------------------------------------------
window.adminRenamePlayer = async function(playerId, currentName) {
  if (!isAdmin) return;
  const newName = prompt('Editar nombre del amigo:', currentName);
  if (!newName || !newName.trim() || newName.trim() === currentName) return;

  try {
    const res = await adminFetch('/api/admin/player', {
      method: 'POST',
      body: JSON.stringify({ action: 'rename', playerId, name: newName.trim() })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Nombre cambiado a "${newName.trim()}" ✏️`, '👤');
      applyRemoteData(data.matchData);
    }
  } catch (e) {}
};

window.adminTogglePay = async function(playerId, paid) {
  if (!isAdmin) return;

  try {
    const res = await adminFetch('/api/admin/player', {
      method: 'POST',
      body: JSON.stringify({ action: 'toggle-pay', playerId, paid })
    });
    const data = await res.json();
    if (data.success) {
      showToast(paid ? 'Marcado como pagado en efectivo 🟢' : 'Marcado como pendiente 🔴');
      applyRemoteData(data.matchData);
    }
  } catch (e) {}
};

window.adminDeletePlayer = async function(playerId) {
  if (!isAdmin) return;
  const p = state.players.find(pl => pl.id === playerId);
  const name = p ? p.name : 'amigo';

  const ok = confirm(`¿Estás seguro de que quieres eliminar a ${name} de la lista?`);
  if (!ok) return;

  try {
    const res = await adminFetch('/api/admin/player', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', playerId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`${name} eliminado`, '🗑️');
      applyRemoteData(data.matchData);
    }
  } catch (e) {}
};

// -------------------------------------------------------------
// TOAST NOTIFICACIÓN
// -------------------------------------------------------------
let toastTimer = null;
function showToast(message, icon = '✅') {
  const toast = document.getElementById('toast');
  document.getElementById('toast-message').textContent = message;
  document.getElementById('toast-icon').textContent = icon;

  toast.classList.remove('opacity-0', '-translate-y-4', 'pointer-events-none');
  toast.classList.add('opacity-100', 'translate-y-0');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
  }, 2600);
}

// -------------------------------------------------------------
// WHATSAPP
// -------------------------------------------------------------
function generateWhatsAppText() {
  const metrics = calculateMetrics(state);
  const quotaStr = formatCurrency(metrics.quota);

  let msg = `⚽ *FÚTBOL CON AMIGOS* ⚽\n`;
  msg += `📍 *Cancha:* ${state.place}\n`;
  msg += `⏰ *Hora:* ${state.datetime}\n`;
  if (metrics.discountFromPrevious > 0) {
    msg += `🎟️ *Descuento Reserva Anterior:* -${formatCurrency(metrics.discountFromPrevious)}\n`;
    msg += `💵 *Costo Cancha:* ${formatCurrency(state.totalCost)} (Neto a pagar: ${formatCurrency(metrics.netCost)})\n`;
  } else {
    msg += `💵 *Costo Cancha:* ${formatCurrency(state.totalCost)}\n`;
  }
  msg += `💸 *Cuota Titulares (14):* ${quotaStr} por persona\n`;
  if (metrics.startersNeeded > 0) {
    msg += `⚠️ *Convocatoria:* Faltan ${metrics.startersNeeded} para los ${metrics.minPlayers} titulares (van ${metrics.totalPlayers}/${metrics.minPlayers})\n\n`;
  } else {
    msg += `🔥 *Convocatoria:* ¡${metrics.minPlayers} Titulares completos! ${metrics.benchCount > 0 ? `(+${metrics.benchCount} en banca)` : ''}\n\n`;
  }

  msg += `📋 *ESTADO DE PAGOS (${metrics.paidCount}/${metrics.totalPlayers}):*\n`;
  state.players.forEach((p, i) => {
    const isStarter = i < metrics.minPlayers;
    const roleTag = isStarter ? `[Titular ${i + 1}]` : `[Banca ${i - metrics.minPlayers + 1}]`;
    const icon = p.paid ? (isStarter ? '✅' : '🎟️') : '❌';
    const status = p.paid 
      ? (isStarter ? 'PAGADO' : 'PAGADO (Reserva Próximo Partido)') 
      : `DEBE ${quotaStr}`;
    msg += `${icon} ${i + 1}. ${p.name} ${roleTag} - ${status}\n`;
  });

  msg += `\n`;
  msg += `💰 *Recaudado Cancha:* ${formatCurrency(metrics.collected)} de ${formatCurrency(metrics.netCost)}\n`;
  if (metrics.reserveFund > 0) {
    msg += `🏦 *Fondo de Reserva Acumulado:* +${formatCurrency(metrics.reserveFund)} (${metrics.benchPaidCount} suplentes pagaron)\n`;
    msg += `*(Este saldo se restará automáticamente en la próxima fecha)*\n`;
  }
  if (metrics.remaining > 0) {
    msg += `⚠️ *Faltan juntar para la cancha:* ${formatCurrency(metrics.remaining)}\n`;
  } else {
    msg += `🎉 *¡Cancha totalmente pagada al 100%!* ⚽\n`;
  }

  return msg;
}

function shareOnWhatsApp() {
  const text = generateWhatsAppText();
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
}

function copySummary() {
  const text = generateWhatsAppText();
  navigator.clipboard.writeText(text).then(() => {
    showToast('Reporte copiado para pegar en WhatsApp 📲', '✅');
  });
}

// -------------------------------------------------------------
// LISTENERS Y SETUP
// -------------------------------------------------------------
function setupEventListeners() {
  // Auto-anotarse al partido (Amigos)
  const formSelfJoin = document.getElementById('form-self-join');
  const inputSelfName = document.getElementById('input-self-name');

  if (formSelfJoin) {
    formSelfJoin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = inputSelfName.value.trim();
      if (!name) return;

      try {
        const res = await fetch('/api/player/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const data = await res.json();

        if (data.success) {
          inputSelfName.value = '';
          showToast(`¡${name} te anotaste al partido! ⚽`, '👤');
          applyRemoteData(data.matchData);
        } else {
          alert(data.error || 'No se pudo anotar');
        }
      } catch (err) {
        showToast('Error de conexión', '⚠️');
      }
    });
  }

  // Modal de pago
  document.getElementById('btn-close-modal-pay').addEventListener('click', closePayModal);

  // Redirigir a Mercado Pago oficial
  document.getElementById('btn-goto-mercadopago').addEventListener('click', () => {
    if (currentCheckoutUrl) {
      window.location.href = currentCheckoutUrl;
    }
  });

  // Login de Admin
  const modalLogin = document.getElementById('modal-login');
  document.getElementById('btn-open-login').addEventListener('click', () => {
    document.getElementById('input-admin-password').value = '';
    document.getElementById('login-error-msg').classList.add('hidden');
    modalLogin.classList.remove('hidden');
    document.getElementById('input-admin-password').focus();
  });
  document.getElementById('btn-close-modal-login').addEventListener('click', () => {
    modalLogin.classList.add('hidden');
  });

  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = document.getElementById('input-admin-password').value.trim();
    if (!pass) return;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
      });
      const data = await res.json();

      if (data.success && data.token) {
        adminToken = data.token;
        sessionStorage.setItem('cancha_admin_token', adminToken);
        modalLogin.classList.add('hidden');
        updateAdminUI();
        showToast('¡Bienvenido Administrador! 👑', '🔓');
        render();
      } else {
        document.getElementById('login-error-msg').classList.remove('hidden');
      }
    } catch (err) {
      alert('Error conectando con el servidor');
    }
  });

  document.getElementById('btn-admin-logout').addEventListener('click', adminLogout);

  // Modal Conectar Mercado Pago (Admin)
  const modalMp = document.getElementById('modal-mp-config');
  document.getElementById('btn-admin-mp').addEventListener('click', () => {
    modalMp.classList.remove('hidden');
  });
  document.getElementById('btn-close-modal-mp').addEventListener('click', () => {
    modalMp.classList.add('hidden');
  });

  document.getElementById('form-mp-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mpAccessToken = document.getElementById('input-mp-token').value.trim();
    const mpPaymentLink = document.getElementById('input-mp-link').value.trim();
    const currency = document.getElementById('input-mp-currency').value;

    try {
      const res = await adminFetch('/api/admin/mercadopago', {
        method: 'POST',
        body: JSON.stringify({ mpAccessToken, mpPaymentLink, currency })
      });
      const data = await res.json();
      if (data.success) {
        modalMp.classList.add('hidden');
        showToast('Conexión con Mercado Pago guardada 💙', '✅');
        applyRemoteData(data.matchData);
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Error al guardar credenciales');
    }
  });

  // Modal Editar Partido
  const modalEdit = document.getElementById('modal-edit-match');
  document.getElementById('btn-admin-edit-match').addEventListener('click', () => {
    document.getElementById('admin-input-place').value = state.place;
    document.getElementById('admin-input-datetime').value = state.datetime;
    document.getElementById('admin-input-total-cost').value = state.totalCost;
    document.getElementById('admin-input-min-players').value = state.minPlayers || 14;
    document.getElementById('admin-input-fixed-quota').value = state.fixedQuota ? state.fixedQuota : '';
    modalEdit.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  });
  document.getElementById('btn-close-modal-edit').addEventListener('click', () => {
    modalEdit.classList.add('hidden');
  });

  document.getElementById('form-edit-match').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      place: document.getElementById('admin-input-place').value.trim(),
      datetime: document.getElementById('admin-input-datetime').value.trim(),
      totalCost: parseFloat(document.getElementById('admin-input-total-cost').value) || 0,
      minPlayers: parseInt(document.getElementById('admin-input-min-players').value) || 14,
      fixedQuota: parseFloat(document.getElementById('admin-input-fixed-quota').value) || 0
    };

    try {
      const res = await adminFetch('/api/admin/match', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        modalEdit.classList.add('hidden');
        showToast('Datos del partido actualizados ⚽', '✅');
        applyRemoteData(data.matchData);
      }
    } catch (err) {
      alert('Error al guardar');
    }
  });

  // Reiniciar Partido
  document.getElementById('btn-admin-reset-match').addEventListener('click', async () => {
    const ok = confirm('¿Quieres reiniciar todos los cobros para el próximo partido?');
    if (!ok) return;

    try {
      const res = await adminFetch('/api/admin/player', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset-payments' })
      });
      const data = await res.json();
      if (data.success) {
        modalEdit.classList.add('hidden');
        showToast('Cobros reiniciados 🔄', '⚽');
        applyRemoteData(data.matchData);
      }
    } catch (e) {}
  });

  // Botón forzar/pausar cobros (Admin)
  const btnToggleForce = document.getElementById('btn-admin-toggle-force-pay');
  if (btnToggleForce) {
    btnToggleForce.addEventListener('click', async () => {
      const nextVal = !state.paymentsUnlocked;
      const msg = nextVal 
        ? '¿Quieres HABILITAR los cobros ahora para todos (aunque no se hayan completado los 14 jugadores)?' 
        : '¿Quieres PAUSAR los cobros hasta que se completen los 14 jugadores?';
      if (!confirm(msg)) return;

      try {
        const res = await adminFetch('/api/admin/match', {
          method: 'POST',
          body: JSON.stringify({ forcePaymentsOpen: nextVal })
        });
        const data = await res.json();
        if (data.success) {
          showToast(nextVal ? 'Cobros habilitados para todos 🔓' : 'Cobros pausados hasta llegar a 14 🔒', '⚡');
          applyRemoteData(data.matchData);
        }
      } catch (e) {}
    });
  }

  // Modal Agregar Amigo
  const modalAdd = document.getElementById('modal-add-player');
  document.getElementById('btn-admin-add-player').addEventListener('click', () => {
    document.getElementById('admin-input-new-player-name').value = '';
    modalAdd.classList.remove('hidden');
    document.getElementById('admin-input-new-player-name').focus();
  });
  document.getElementById('btn-close-modal-add').addEventListener('click', () => {
    modalAdd.classList.add('hidden');
  });

  document.getElementById('form-admin-add-player').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('admin-input-new-player-name').value.trim();
    if (!name) return;

    try {
      const res = await adminFetch('/api/admin/player', {
        method: 'POST',
        body: JSON.stringify({ action: 'add', name })
      });
      const data = await res.json();
      if (data.success) {
        modalAdd.classList.add('hidden');
        showToast(`${name} agregado 👤`, '✅');
        applyRemoteData(data.matchData);
      }
    } catch (e) {}
  });

  // Modal Cambiar Clave
  const modalPass = document.getElementById('modal-change-pass');
  document.getElementById('btn-admin-change-pass').addEventListener('click', () => {
    document.getElementById('input-new-pass').value = '';
    modalPass.classList.remove('hidden');
    document.getElementById('input-new-pass').focus();
  });
  document.getElementById('btn-close-modal-pass').addEventListener('click', () => {
    modalPass.classList.add('hidden');
  });

  document.getElementById('form-admin-change-pass').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPass = document.getElementById('input-new-pass').value.trim();
    if (!newPass) return;

    try {
      const res = await adminFetch('/api/admin/password', {
        method: 'POST',
        body: JSON.stringify({ newPassword: newPass })
      });
      const data = await res.json();
      if (data.success) {
        modalPass.classList.add('hidden');
        showToast('¡Clave de admin actualizada! 🔐', '✅');
      } else {
        alert(data.error);
      }
    } catch (e) {}
  });

  // Modal Crear Nuevo Partido (Admin)
  const modalNewMatch = document.getElementById('modal-new-match');
  const btnOpenNewMatch = document.getElementById('btn-admin-new-match');
  const btnCloseNewMatch = document.getElementById('btn-close-modal-new-match');
  const formNewMatch = document.getElementById('form-new-match');
  const inputNewPlace = document.getElementById('new-match-place');
  const inputNewDatetime = document.getElementById('new-match-datetime');
  const inputNewTotalCost = document.getElementById('new-match-total-cost');
  const inputNewMinPlayers = document.getElementById('new-match-min-players');
  const checkApplyReserve = document.getElementById('check-apply-reserve');

  function updateNewMatchPreview() {
    if (!inputNewTotalCost || !inputNewMinPlayers) return;
    const total = parseFloat(inputNewTotalCost.value) || 0;
    const minP = parseInt(inputNewMinPlayers.value) || 14;
    const metrics = calculateMetrics(state);
    const reserve = (checkApplyReserve && checkApplyReserve.checked) ? metrics.reserveFund : 0;
    const net = Math.max(0, total - reserve);
    const quota = minP > 0 ? Math.ceil(net / minP) : 0;

    const previewTotal = document.getElementById('preview-new-total');
    const previewDiscount = document.getElementById('preview-new-discount');
    const previewNet = document.getElementById('preview-new-net');
    const previewQuota = document.getElementById('preview-new-quota');

    if (previewTotal) previewTotal.textContent = formatCurrency(total);
    if (previewDiscount) previewDiscount.textContent = `-${formatCurrency(reserve)}`;
    if (previewNet) previewNet.textContent = formatCurrency(net);
    if (previewQuota) previewQuota.textContent = `${formatCurrency(quota)} c/u`;
  }

  if (btnOpenNewMatch) {
    btnOpenNewMatch.addEventListener('click', () => {
      if (inputNewPlace) inputNewPlace.value = state.place || '';
      if (inputNewDatetime) inputNewDatetime.value = '';
      if (inputNewTotalCost) inputNewTotalCost.value = state.totalCost || 40000;
      if (inputNewMinPlayers) inputNewMinPlayers.value = state.minPlayers || 14;
      if (checkApplyReserve) checkApplyReserve.checked = true;
      updateNewMatchPreview();
      if (modalNewMatch) modalNewMatch.classList.remove('hidden');
      if (inputNewDatetime) inputNewDatetime.focus();
      if (window.lucide) lucide.createIcons();
    });
  }

  if (btnCloseNewMatch) {
    btnCloseNewMatch.addEventListener('click', () => {
      if (modalNewMatch) modalNewMatch.classList.add('hidden');
    });
  }

  if (inputNewTotalCost) inputNewTotalCost.addEventListener('input', updateNewMatchPreview);
  if (inputNewMinPlayers) inputNewMinPlayers.addEventListener('input', updateNewMatchPreview);
  if (checkApplyReserve) checkApplyReserve.addEventListener('change', updateNewMatchPreview);

  if (formNewMatch) {
    formNewMatch.addEventListener('submit', async (e) => {
      e.preventDefault();
      const place = inputNewPlace.value.trim();
      const datetime = inputNewDatetime.value.trim();
      const totalCost = parseFloat(inputNewTotalCost.value) || 0;
      const minPlayers = parseInt(inputNewMinPlayers.value) || 14;
      const applyReserveDiscount = checkApplyReserve ? checkApplyReserve.checked : true;

      const metrics = calculateMetrics(state);
      const discountAmount = applyReserveDiscount ? metrics.reserveFund : 0;

      const confirmMsg = `¿Estás seguro de crear el nuevo partido en "${place}" (${datetime})?\n\n` +
        `• Se iniciará una lista de jugadores limpia desde cero.\n` +
        `• Descuento de reserva aplicado a la cancha: ${formatCurrency(discountAmount)}.\n` +
        `• Costo neto a recaudar: ${formatCurrency(Math.max(0, totalCost - discountAmount))}.`;
      if (!confirm(confirmMsg)) return;

      try {
        const res = await adminFetch('/api/admin/new-match', {
          method: 'POST',
          body: JSON.stringify({
            place,
            datetime,
            totalCost,
            minPlayers,
            applyReserveDiscount
          })
        });
        const data = await res.json();
        if (data.success) {
          if (modalNewMatch) modalNewMatch.classList.add('hidden');
          showToast('¡Nuevo partido creado con éxito! 🏆⚽', '🎉');
          fireConfetti();
          playSound('goal');
          applyRemoteData(data.matchData);
        } else {
          alert(data.error || 'Error al crear nuevo partido');
        }
      } catch (err) {
        alert('Error de conexión con el servidor');
      }
    });
  }

  // Filtros
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentFilter = btn.getAttribute('data-filter');

      filterBtns.forEach(b => {
        b.classList.remove('bg-slate-800', 'text-white');
        b.classList.add('text-slate-400');
      });
      btn.classList.add('bg-slate-800', 'text-white');
      btn.classList.remove('text-slate-400');

      render();
    });
  });

  // WhatsApp
  document.getElementById('btn-share-whatsapp').addEventListener('click', shareOnWhatsApp);
  document.getElementById('btn-copy-summary').addEventListener('click', copySummary);
}

document.addEventListener('DOMContentLoaded', initApp);
