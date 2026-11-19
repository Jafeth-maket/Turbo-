// ============================================================
//  TURBO RUSH - CONFIGURACIÓN
//  Todo lo importante del juego se controla desde este archivo:
//  dinero, velocidad del motor, autos, mejoras, tráfico...
//  Cambia los números, guarda, y listo.
// ============================================================
const CONFIG = {
  nombreJuego: "Turbo Rush",
  saveKey: "turborush_save_v1",   // si lo cambias, el progreso guardado se reinicia

  // ---------- DINERO ----------
  dineroInicial: 0,        // dinero con el que empieza una partida nueva
  valorMoneda: 10,         // dinero por cada moneda recogida
  dineroPorBloque: 5,      // dinero extra por cada 100 m recorridos

  // ---------- CARRERA ----------
  carriles: 4,
  velocidadInicial: 90,    // km/h al arrancar
  velocidadLateral: 11,    // qué tan rápido gira el auto a los lados (metros/segundo)

  // ---------- NITRO ----------
  nitroBase: 1.30,         // multiplicador de velocidad máxima con nitro (sin mejoras)
  nitroCapacidad: 100,     // capacidad del tanque de nitro (sin mejoras)
  nitroConsumo: 30,        // cuánto se gasta por segundo
  nitroRegen: 7,           // cuánto se recarga por segundo
  nitroMinimo: 0.15,       // tras vaciarse, el nitro vuelve a poder usarse al soltar el botón y recargar este % (0.15 = 15%)

  // ---------- MODO CARRERA ----------
  carrera: {
    metaMetros: 3000,        // distancia hasta la meta
    cuentaRegresiva: 3,      // segundos de cuenta regresiva
    velSalida: 60,           // km/h al arrancar o al reaparecer tras un choque
    invulnerable: 2.0,       // segundos sin poder chocar al reaparecer (el auto parpadea)
    ventajaMax: 170,         // si un bot va más de esta distancia (m) delante tuyo, se frena
    retrasoMax: 100,         // si va más de esta distancia atrás, se acelera para alcanzarte
    premios: [500, 250, 120, 50],   // dinero por puesto (1º, 2º, 3º, 4º)
    // nivel: velocidad del bot respecto a TU auto (1.0 = igual) | error: probabilidad de NO esquivar un carro
    rivales: [
      { nombre: "Rayo",  color: "#00e5ff", nivel: 0.93, error: 0.30 },
      { nombre: "Cobra", color: "#76ff03", nivel: 0.97, error: 0.22 },
      { nombre: "Turbo", color: "#ff6d00", nivel: 1.00, error: 0.15 }
    ]
  },

  // ---------- TRÁFICO ----------
  trafico: {
    velMin: 40,            // km/h del tráfico (debe ser menor que velocidadInicial)
    velMax: 80,
    probCamion: 0.18,      // probabilidad de que un vehículo sea camión
    probDobleInicial: 0.15,// probabilidad de 2 autos en la misma fila (sube con la distancia)
    probDobleMax: 0.55,
    separacionBase: 36,    // distancia mínima entre filas de tráfico (metros)
    separacionPorVel: 0.25 // metros extra por cada km/h de velocidad
  },

  // ---------- AUTOS ----------
  // velMax: velocidad máxima (km/h) | aceleracion: km/h por segundo | agarre: giro lateral
  autos: [
    { id: "rojo",    nombre: "Pixel Rojo", precio: 0,     color: "#e53935", velMax: 200, aceleracion: 30, agarre: 1.00 },
    { id: "azul",    nombre: "Rayo Azul",  precio: 1500,  color: "#1e88e5", velMax: 240, aceleracion: 38, agarre: 1.15 },
    { id: "morado",  nombre: "Fantasma",   precio: 5000,  color: "#8e24aa", velMax: 285, aceleracion: 46, agarre: 1.30 },
    { id: "dorado",  nombre: "Dorado X",   precio: 15000, color: "#fbc02d", velMax: 330, aceleracion: 55, agarre: 1.45 }
  ],

  // ---------- MEJORAS (por auto) ----------
  // costo del nivel N = costoBase * crecimiento^N
  mejoras: {
    motor:   { nombre: "Motor",   icono: "⚙️", info: "Más velocidad máxima y aceleración",
               max: 10, costoBase: 200, crecimiento: 1.55, velPorNivel: 18, accelPorNivel: 4 },
    nitro:   { nombre: "Nitro",   icono: "🔥", info: "Más potencia y capacidad de nitro",
               max: 10, costoBase: 150, crecimiento: 1.50, potenciaPorNivel: 0.04, capacidadPorNivel: 8 },
    llantas: { nombre: "Llantas", icono: "🛞", info: "Cambios de carril más rápidos",
               max: 10, costoBase: 120, crecimiento: 1.45, agarrePorNivel: 0.08 }
  },

  // ---------- AMBIENTES (cambian cada cierta distancia) ----------
  metrosPorAmbiente: 1500,

  sonido: true
};
