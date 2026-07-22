/* ======================================================================
   BUSCAMINAS — Lógica del juego

   Idea central: cada celda es un objeto { mine, revealed, flagged, adj, el }
   guardado en el arreglo `cells`. La posición (fila, columna) se traduce a
   un índice único con la fórmula:  índice = fila * cols + col
   y al revés:                      fila = índice / cols ,  col = índice % cols
   ====================================================================== */

// --- Configuración de dificultades (columnas, filas y nº de minas) ---
const NIVELES = {
  facil:   { cols: 9,  rows: 9,  minas: 10 },
  medio:   { cols: 16, rows: 16, minas: 40 },
  experto: { cols: 30, rows: 16, minas: 99 },
};

// --- Referencias a los elementos del HTML ---
const boardEl   = document.getElementById('board');
const faceEl    = document.getElementById('face');
const mineEl    = document.getElementById('mineCount');
const timeEl    = document.getElementById('time');
const msgEl     = document.getElementById('msg');
const flagBtn   = document.getElementById('flagToggle');

// --- Estado del juego (cambia durante la partida, por eso es let) ---
let cols, rows, minas;      // tamaño y minas del nivel actual
let cells = [];             // arreglo con todas las celdas
let primerClic = true;      // true hasta el primer clic (para inicio seguro)
let terminado = false;      // true al ganar o perder
let banderas = 0;           // banderas colocadas
let reveladas = 0;          // celdas reveladas sin mina
let flagMode = false;       // modo bandera para móvil
let timer = null;           // referencia del cronómetro
let segundos = 0;           // tiempo transcurrido

/* ------- Iniciar / reiniciar una partida ------- */
function iniciar(nivel){
  const cfg = NIVELES[nivel];
  cols = cfg.cols; rows = cfg.rows; minas = cfg.minas;

  // Reiniciamos todo el estado
  cells = [];
  primerClic = true;
  terminado = false;
  banderas = 0;
  reveladas = 0;
  segundos = 0;
  detenerTiempo();

  faceEl.textContent = '🙂';
  timeEl.textContent = '000';
  msgEl.className = 'msg';
  msgEl.textContent = '';
  actualizarContador();

  // Ajustamos el tamaño de celda para que el tablero quepa bien
  ajustarTamañoCelda();

  // Construimos el tablero en el DOM
  boardEl.style.setProperty('--cols', cols);  // le decimos al CSS cuántas columnas
  boardEl.innerHTML = '';
  const frag = document.createDocumentFragment();  // fragmento: más eficiente que añadir 1 a 1

  for (let i = 0; i < cols * rows; i++){
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.dataset.i = i;
    btn.setAttribute('aria-label', 'celda oculta');

    // Clic izquierdo = revelar
    btn.addEventListener('click', () => onClic(i));
    // Clic derecho = poner/quitar bandera (preventDefault quita el menú del navegador)
    btn.addEventListener('contextmenu', e => { e.preventDefault(); onBandera(i); });
    // Pulsación larga en móvil = bandera
    agregarPulsacionLarga(btn, i);

    // Guardamos la celda en el arreglo y en la pantalla
    cells.push({ mine:false, revealed:false, flagged:false, adj:0, el:btn });
    frag.appendChild(btn);
  }
  boardEl.appendChild(frag);
}

/* ------- Calcula un tamaño de celda que entre en pantalla ------- */
function ajustarTamañoCelda(){
  const dispo = Math.min(window.innerWidth - 70, 680); // ancho disponible
  let tam = Math.floor((dispo - (cols - 1) * 3 - 6) / cols);
  tam = Math.max(24, Math.min(tam, 40)); // entre 24 y 40 px (si no cabe, habrá scroll)
  document.documentElement.style.setProperty('--cell', tam + 'px');
}

/* ------- Colocar minas (después del primer clic, con zona segura) -------
   Se llama tras el primer clic. Garantizamos que ni esa celda ni sus
   vecinas tengan mina, para que el jugador siempre tenga una apertura. */
function colocarMinas(indiceSeguro){
  const seguras = new Set([indiceSeguro, ...vecinos(indiceSeguro)]);
  let puestas = 0;
  while (puestas < minas){
    const r = Math.floor(Math.random() * cells.length);
    if (cells[r].mine || seguras.has(r)) continue;  // ya tiene mina o es zona segura
    cells[r].mine = true;
    puestas++;
  }
  // Para cada celda sin mina, contamos cuántas minas tiene alrededor
  for (let i = 0; i < cells.length; i++){
    if (cells[i].mine) continue;
    cells[i].adj = vecinos(i).filter(v => cells[v].mine).length;
  }
}

/* ------- Devuelve los índices de las celdas vecinas (hasta 8) ------- */
function vecinos(i){
  const r = Math.floor(i / cols), c = i % cols;
  const v = [];
  for (let dr = -1; dr <= 1; dr++){
    for (let dc = -1; dc <= 1; dc++){
      if (dr === 0 && dc === 0) continue;       // saltamos la propia celda
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols){  // dentro del tablero
        v.push(nr * cols + nc);
      }
    }
  }
  return v;
}

/* ------- Clic izquierdo sobre una celda ------- */
function onClic(i){
  if (terminado) return;
  const cell = cells[i];

  // Si está activo el modo bandera (móvil), poner/quitar bandera
  if (flagMode){ onBandera(i); return; }
  if (cell.flagged) return;

  // En el primer clic generamos las minas y arrancamos el tiempo
  if (primerClic){
    colocarMinas(i);
    primerClic = false;
    iniciarTiempo();
  }

  // "Chord": clic sobre un número ya revelado revela sus vecinos
  // si tiene la cantidad correcta de banderas alrededor
  if (cell.revealed && cell.adj > 0){
    acorde(i);
    return;
  }

  if (cell.revealed) return;

  if (cell.mine){ perder(i); return; }  // pisó una mina

  revelarCascada(i);
  comprobarVictoria();
}

/* ------- Revelado en cascada (flood fill iterativo con pila) -------
   Si una celda no tiene minas alrededor (adj === 0), revelamos también
   a sus vecinas, y así en cadena. Usamos una pila en vez de recursión
   para que no falle en tableros grandes. */
function revelarCascada(inicio){
  const pila = [inicio];
  while (pila.length){
    const i = pila.pop();
    const cell = cells[i];
    if (cell.revealed || cell.flagged) continue;

    cell.revealed = true;
    reveladas++;
    pintarRevelada(i);

    // Si está vacía (0 minas alrededor), seguimos con sus vecinas
    if (cell.adj === 0){
      vecinos(i).forEach(v => {
        if (!cells[v].revealed) pila.push(v);
      });
    }
  }
}

/* ------- Aplica el estilo visual de celda revelada ------- */
function pintarRevelada(i){
  const cell = cells[i];
  cell.el.classList.add('open');
  cell.el.setAttribute('aria-label', cell.adj > 0 ? cell.adj + ' minas cerca' : 'vacía');
  if (cell.adj > 0){
    cell.el.textContent = cell.adj;
    cell.el.classList.add('n' + cell.adj);  // le pone el color según el número
  }
}

/* ------- "Chord": revelar los vecinos de un número ya abierto -------
   Mecánica clásica: si un número tiene tantas banderas alrededor como su
   valor, al hacerle clic se descubren las demás celdas vecinas de golpe. */
function acorde(i){
  const cell = cells[i];
  const vs = vecinos(i);
  const banderasAlrededor = vs.filter(v => cells[v].flagged).length;

  // Solo actúa si el nº de banderas coincide con el número de la celda
  if (banderasAlrededor !== cell.adj) return;

  for (const v of vs){
    if (cells[v].flagged || cells[v].revealed) continue;
    if (cells[v].mine){ perder(v); return; }  // si una bandera estaba mal, ¡boom!
    revelarCascada(v);
  }
  comprobarVictoria();
}

/* ------- Poner / quitar bandera ------- */
function onBandera(i){
  if (terminado) return;
  const cell = cells[i];
  if (cell.revealed) return;

  // No dejamos poner más banderas que minas hay
  if (!cell.flagged && banderas >= minas) return;

  // Si es la primera acción, también generamos las minas y arrancamos el reloj
  if (primerClic){ iniciarTiempo(); primerClic = false; colocarMinas(i); }

  cell.flagged = !cell.flagged;               // alternamos
  banderas += cell.flagged ? 1 : -1;

  if (cell.flagged){
    cell.el.classList.add('flag');
    cell.el.textContent = '🚩';
    cell.el.setAttribute('aria-label', 'con bandera');
  } else {
    cell.el.classList.remove('flag');
    cell.el.textContent = '';
    cell.el.setAttribute('aria-label', 'celda oculta');
  }
  actualizarContador();
}

/* ------- Perder: se detonó una mina ------- */
function perder(iBomba){
  terminado = true;
  detenerTiempo();
  faceEl.textContent = '😵';

  cells[iBomba].el.classList.add('boom');   // resaltamos la mina detonada

  // Revelamos todas las minas y marcamos las banderas equivocadas
  cells.forEach((cell, i) => {
    if (cell.mine && !cell.flagged){
      cell.el.classList.add('open', 'mine');
      if (i !== iBomba) cell.el.textContent = '💣';
      else cell.el.textContent = '💥';
    } else if (cell.flagged && !cell.mine){
      cell.el.classList.remove('flag');
      cell.el.classList.add('open', 'wrong');
      cell.el.textContent = '';
    }
  });

  mostrarMensaje('💥 ¡Boom! Pisaste una mina. Inténtalo de nuevo.', 'lose');
}

/* ------- Comprobar si el jugador ganó ------- */
function comprobarVictoria(){
  // Se gana cuando todas las celdas SIN mina están reveladas
  if (reveladas === cells.length - minas){
    terminado = true;
    detenerTiempo();
    faceEl.textContent = '😎';

    // Marcamos automáticamente todas las minas con bandera
    cells.forEach(cell => {
      if (cell.mine && !cell.flagged){
        cell.flagged = true;
        cell.el.classList.add('flag');
        cell.el.textContent = '🚩';
      }
    });
    banderas = minas;
    actualizarContador();
    mostrarMensaje(`🎉 ¡Ganaste en ${segundos} segundos! Bien hecho.`, 'win');
  }
}

/* ------- Contador de minas restantes (minas − banderas) ------- */
function actualizarContador(){
  const restantes = Math.max(0, minas - banderas);
  mineEl.textContent = String(restantes).padStart(3, '0');  // 7 -> "007"
}

/* ------- Cronómetro ------- */
function iniciarTiempo(){
  detenerTiempo();
  timer = setInterval(() => {
    segundos++;
    timeEl.textContent = String(Math.min(segundos, 999)).padStart(3, '0');
  }, 1000);
}
function detenerTiempo(){ if (timer){ clearInterval(timer); timer = null; } }

/* ------- Mensaje de resultado ------- */
function mostrarMensaje(texto, tipo){
  msgEl.textContent = texto;
  msgEl.className = 'msg show ' + tipo;   // tipo = 'win' o 'lose'
}

/* ------- Pulsación larga (móvil) para poner bandera -------
   Si el dedo se queda 380 ms sin moverse, contamos como "bandera". */
function agregarPulsacionLarga(el, i){
  let t = null;
  let movido = false;
  const inicio = () => { movido = false; t = setTimeout(() => { onBandera(i); t = null; }, 380); };
  const fin = () => { if (t){ clearTimeout(t); t = null; } };
  el.addEventListener('touchstart', inicio, { passive:true });
  el.addEventListener('touchmove', () => { movido = true; fin(); }, { passive:true });
  el.addEventListener('touchend', fin);
  el.addEventListener('touchcancel', fin);
}

/* ------- "Suspenso": la cara se sorprende al presionar el tablero ------- */
boardEl.addEventListener('pointerdown', () => { if (!terminado) faceEl.textContent = '😮'; });
document.addEventListener('pointerup', () => { if (!terminado) faceEl.textContent = '🙂'; });

/* ====== Eventos de la interfaz ====== */

// Botón de cara = nueva partida con el nivel actual
faceEl.addEventListener('click', () => iniciar(nivelActual));

// Selector de dificultad
let nivelActual = 'facil';
document.getElementById('levels').addEventListener('click', e => {
  const btn = e.target.closest('.level');
  if (!btn) return;
  document.querySelectorAll('.level').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  nivelActual = btn.dataset.level;
  iniciar(nivelActual);
});

// Modo bandera (toggle, útil en móvil)
flagBtn.addEventListener('click', () => {
  flagMode = !flagMode;
  flagBtn.classList.toggle('on', flagMode);
  flagBtn.setAttribute('aria-pressed', String(flagMode));
});

// Reajustar el tamaño de celda si cambia el tamaño de la ventana
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(ajustarTamañoCelda, 150);
});

// ¡Arrancar! Empezamos en dificultad fácil
iniciar('facil');
