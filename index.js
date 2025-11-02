// 1. Importar herramientas
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

// Importa las funciones necesarias de date-fns
const { eachDayOfInterval, getDay, parseISO, format, getHours, startOfDay, endOfDay } = require('date-fns');
// --- IMPORTACIÓN AÑADIDA PARA ZONA HORARIA ---
const { utcToZonedTime } = require('date-fns-tz');

// 2. Crear el servidor API
const app = express();

// 3. Configurar el servidor
app.use(cors());
app.use(express.json());

// 4. Conectar a la Base de Datos
const db = mysql.createConnection({
  host: process.env.MYSQLHOST,     // Railway te dará esta variable
  user: process.env.MYSQLUSER,     // Railway te dará esta variable
  password: process.env.MYSQLPASSWORD, // Railway te dará esta variable
  database: process.env.MYSQLDATABASE, // Railway te dará esta variable
  port: process.env.MYSQLPORT        // Railway te dará esta variable
});

// Verificador de conexión
db.connect(err => {
  if (err) {
    console.error('!!! ERROR al conectar a la base de datos:', err);
    return;
  }
  console.log('*** Conectado exitosamente a la base de datos MySQL ***');
});

// --- RUTA DE LOGIN (ACTUALIZADA para devolver más datos) ---
app.post('/login', (req, res) => {
  const { usuario, password } = req.body;
  // Selecciona TODOS los campos necesarios para Flutter
  const query = `
    SELECT id, nombre_completo, email, codigo_alumno, dni, carrera
    FROM usuarios
    WHERE email = ? AND password = ?
  `; // Asegúrate que tu columna se llame 'nombre_completo'

  db.query(query, [usuario, password], (err, results) => {
    if (err) {
      console.error('Error en la consulta de login:', err);
      return res.status(500).json({ status: 'error', message: 'Error del servidor' });
    }
    if (results.length > 0) {
      const usuarioEncontrado = results[0];
      console.log(`Login exitoso para: ${usuarioEncontrado.nombre_completo} (ID: ${usuarioEncontrado.id})`);
      // Devuelve los datos dentro de un objeto 'userData'
      res.json({
        status: 'success',
        message: 'Login correcto',
        userData: { // <-- Objeto que espera Flutter
            usuarioId: usuarioEncontrado.id,
            nombreCompleto: usuarioEncontrado.nombre_completo,
            email: usuarioEncontrado.email,
            codigoAlumno: usuarioEncontrado.codigo_alumno,
            dni: usuarioEncontrado.dni,
            carrera: usuarioEncontrado.carrera
        }
      });
    } else {
      console.log('Login fallido: credenciales incorrectas');
      res.json({
        status: 'error',
        message: 'Usuario o contraseña incorrectos'
      });
    }
  });
});
// --- FIN RUTA LOGIN ---


// --- RUTA DE HORARIO (CON RECURRENCIAS) ---
app.get('/horario/:usuarioId', (req, res) => {

  const usuarioId = req.params.usuarioId;
  let fechaInicioRango, fechaFinRango;
  try {
      fechaInicioRango = req.query.inicio ? parseISO(req.query.inicio) : null;
      fechaFinRango = req.query.fin ? parseISO(req.query.fin) : null;
      if (!fechaInicioRango || !fechaFinRango || isNaN(fechaInicioRango) || isNaN(fechaFinRango) || fechaInicioRango > fechaFinRango) {
          throw new Error('Fechas inválidas');
      }
  } catch (error) {
      console.error('Error parseando fechas:', error.message);
      return res.status(400).json({ status: 'error', message: 'Rango de fechas inválido o faltante (formato YYYY-MM-DD)' });
  }

  console.log(`Petición de horario para UserID ${usuarioId} entre ${format(fechaInicioRango, 'yyyy-MM-dd')} y ${format(fechaFinRango, 'yyyy-MM-dd')}`);

  const queryReglas = `
    SELECT r.id, r.curso_id, r.dia_semana, r.hora_inicio, r.hora_fin,
           r.fecha_inicio_validez, r.fecha_fin_validez, r.aula, c.nombre_curso
    FROM reglas_horario r JOIN cursos c ON r.curso_id = c.id
    WHERE r.usuario_id = ? AND r.fecha_inicio_validez <= ? AND r.fecha_fin_validez >= ?
  `;

  db.query(queryReglas, [usuarioId, format(fechaFinRango, 'yyyy-MM-dd'), format(fechaInicioRango, 'yyyy-MM-dd')], (err, reglas) => {
    if (err) {
      console.error('Error al consultar reglas de horario:', err);
      return res.status(500).json({ status: 'error', message: 'Error del servidor al buscar reglas' });
    }
    console.log(`Encontradas ${reglas.length} reglas aplicables.`);

    const eventosGenerados = [];
    let diasEnRango = [];
    try {
        diasEnRango = eachDayOfInterval({ start: fechaInicioRango, end: fechaFinRango });
    } catch (error) {
        console.error("Error generando intervalo:", error);
        return res.status(500).json({ status: 'error', message: 'Error interno generando fechas' });
    }

    diasEnRango.forEach(diaActual => {
      const diaSemanaActual = getDay(diaActual);
      reglas.forEach(regla => {
        const inicioValidezRegla = new Date(regla.fecha_inicio_validez);
        const finValidezRegla = new Date(regla.fecha_fin_validez);
        finValidezRegla.setUTCHours(23, 59, 59, 999); // Incluir el último día

        if (regla.dia_semana === diaSemanaActual && diaActual >= inicioValidezRegla && diaActual <= finValidezRegla) {
          const horaInicioParts = regla.hora_inicio.split(':');
          const horaFinParts = regla.hora_fin.split(':');
           const fechaHoraInicio = new Date(Date.UTC( diaActual.getUTCFullYear(), diaActual.getUTCMonth(), diaActual.getUTCDate(), parseInt(horaInicioParts[0]), parseInt(horaInicioParts[1]), parseInt(horaInicioParts[2] || '00') ));
           const fechaHoraFin = new Date(Date.UTC( diaActual.getUTCFullYear(), diaActual.getUTCMonth(), diaActual.getUTCDate(), parseInt(horaFinParts[0]), parseInt(horaFinParts[1]), parseInt(horaFinParts[2] || '00') ));

          eventosGenerados.push({
            id: `regla-${regla.id}-dia-${format(diaActual, 'yyyyMMdd')}`,
            nombre_curso: regla.nombre_curso,
            fecha_hora_inicio: fechaHoraInicio.toISOString(),
            fecha_hora_fin: fechaHoraFin.toISOString(),
            aula: regla.aula
          });
        }
      });
    });

    console.log(`Generados ${eventosGenerados.length} eventos.`);
    res.json({ status: 'success', eventos: eventosGenerados });
  });
});
// --- FIN RUTA HORARIO ---


// --- RUTA COMEDOR (MODIFICADA CON HORA DE PERÚ) ---
app.post('/comedor/reservar', (req, res) => {
  const { codigoAlumno, dni } = req.body;
  if (!codigoAlumno || !dni) {
    return res.status(400).json({ status: 'error', message: 'Código de alumno y DNI son requeridos' });
  }

  // Iniciar Transacción
  db.beginTransaction(err => {
    if (err) { console.error("Error iniciando TX:", err); return res.status(500).json({ status: 'error', message: 'Error interno (TX)' }); }

    // Paso 1 (Dentro TX): Buscar Usuario
    const queryBuscarUsuario = 'SELECT id FROM usuarios WHERE codigo_alumno = ? AND dni = ?';
    db.query(queryBuscarUsuario, [codigoAlumno, dni], (err, users) => {
      if (err) { return db.rollback(() => res.status(500).json({ status: 'error', message: 'Error DB buscando usuario' })); }
      if (users.length === 0) { return db.rollback(() => res.json({ status: 'error', message: 'Código de alumno o DNI no encontrado/inválido' })); }
      const usuarioId = users[0].id;
      
      // --- ¡MODIFICACIÓN DE HORA! ---
      const fechaActualUTC = new Date(); // Hora UTC del servidor (Railway)
      const zonaHorariaPeru = 'America/Lima'; // Zona horaria de Perú
      // Convierte la hora UTC a la hora de Lima
      const fechaActualPeru = utcToZonedTime(fechaActualUTC, zonaHorariaPeru); 

      // Usa la fecha de Perú para la BD (formato YYYY-MM-DD)
      const hoyStr = format(fechaActualPeru, 'yyyy-MM-dd'); 
      // Usa la hora de Perú para la lógica (número 0-23)
      const horaActual = getHours(fechaActualPeru); 
      // --- FIN DE LA MODIFICACIÓN DE HORA ---

      console.log(`Hora UTC: ${fechaActualUTC}, Hora en Perú: ${fechaActualPeru} (Hora: ${horaActual})`); // Log

      let tipoComida; // Determinar tipoComida... (esta lógica ahora usa la hora de Perú)
      if (horaActual >= 7 && horaActual < 10) { tipoComida = 'Desayuno'; }
      else if (horaActual >= 12 && horaActual < 16) { tipoComida = 'Almuerzo'; }
      else if (horaActual >= 18 && horaActual < 21) { tipoComida = 'Cena'; }
      else { return db.rollback(() => res.json({ status: 'error', message: `No hay servicio de comedor disponible en este horario (${horaActual}h en Perú)` })); }

      // Paso 2 (Dentro TX): Verificar reserva existente
      const queryVerificarReserva = 'SELECT id FROM reservas_comedor WHERE usuario_id = ? AND fecha_reserva = ? AND tipo_comida = ?';
      db.query(queryVerificarReserva, [usuarioId, hoyStr, tipoComida], (err, reservasExistentes) => {
        if (err) { return db.rollback(() => res.status(500).json({ status: 'error', message: 'Error DB verificando reserva' })); }
        if (reservasExistentes.length > 0) { return db.rollback(() => res.json({ status: 'error', message: `Ya tienes una reserva para ${tipoComida} hoy` })); }

        // --- INICIO DE CONSULTAS SEPARADAS PARA CUPOS ---
        // Paso 3a (Dentro TX): Asegurar que la fila de cupos exista
        const cuposTotalesDefault = tipoComida === 'Almuerzo' ? 100 : 50;
        const queryAsegurarCupos = `
          INSERT INTO cupos_comedor (fecha, tipo_comida, cupos_totales, cupos_disponibles)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE id=id; -- No hace nada si ya existe
        `;
        db.query(queryAsegurarCupos, [hoyStr, tipoComida, cuposTotalesDefault, cuposTotalesDefault], (err, resultInsert) => {
           if (err) {
              console.error("Error asegurando fila de cupos (TX):", err);
              return db.rollback(() => res.status(500).json({ status: 'error', message: 'Error DB preparando cupos' }));
           }

           // Paso 3b (Dentro TX): Seleccionar cupos disponibles y BLOQUEAR
           const querySeleccionarCupos = 'SELECT cupos_disponibles FROM cupos_comedor WHERE fecha = ? AND tipo_comida = ? FOR UPDATE';
           db.query(querySeleccionarCupos, [hoyStr, tipoComida], (err, resultsCupos) => {
              if (err) {
                 console.error("Error seleccionando/bloqueando cupos (TX):", err);
                 return db.rollback(() => res.status(500).json({ status: 'error', message: 'Error DB obteniendo cupos' }));
              }

              if (resultsCupos.length === 0) {
                 console.error("Error crítico: Fila de cupos no encontrada después de asegurar su existencia.");
                 return db.rollback(() => res.status(500).json({ status: 'error', message: 'Error interno (cupos)' }));
              }
              const cuposDisponibles = resultsCupos[0].cupos_disponibles;

              if (cuposDisponibles <= 0) {
                 return db.rollback(() => res.json({ status: 'error', message: `No hay cupos disponibles para ${tipoComida}` }));
              }

              // Paso 4 (Dentro TX): Insertar la reserva
              const queryReservar = 'INSERT INTO reservas_comedor (usuario_id, fecha_reserva, tipo_comida) VALUES (?, ?, ?)';
              db.query(queryReservar, [usuarioId, hoyStr, tipoComida], (err, resultReserva) => {
                 if (err) { return db.rollback(() => res.status(500).json({ status: 'error', message: 'Error DB creando reserva' })); }

                 // Paso 5 (Dentro TX): Decrementar el cupo
                 const queryDecrementar = 'UPDATE cupos_comedor SET cupos_disponibles = cupos_disponibles - 1 WHERE fecha = ? AND tipo_comida = ? AND cupos_disponibles > 0';
                 db.query(queryDecrementar, [hoyStr, tipoComida], (err, resultUpdate) => {
                    if (err) { return db.rollback(() => res.status(500).json({ status: 'error', message: 'Error DB actualizando cupos' })); }

                    if (resultUpdate.affectedRows > 0) {
                       // ¡ÉXITO TOTAL! Hacer commit
                       db.commit(err => {
                          if (err) { return db.rollback(() => res.status(500).json({ status: 'error', message: 'Error finalizando reserva' })); }
                          console.log(`Reserva exitosa (TX) para UserID ${usuarioId} - ${tipoComida} ${hoyStr}`);
                          res.json({ status: 'success', message: `Reserva para ${tipoComida} confirmada` });
                       });
                    } else {
                       console.warn("No se pudo decrementar cupo (posible condición de carrera o 0 cupos).");
                       db.rollback(() => res.json({ status: 'error', message: 'No se pudo completar la reserva (cupo agotado)' }));
                    }
                 }); // Fin queryDecrementar
              }); // Fin queryReservar
           }); // Fin querySeleccionarCupos
        }); // Fin queryAsegurarCupos
      }); // Fin queryVerificarReserva
    }); // Fin queryBuscarUsuario
  }); // Fin beginTransaction
});
// --- FIN RUTA COMEDOR ---

// --- **NUEVA RUTA**: OBTENER NOTICIAS ---
app.get('/noticias', (req, res) => {
  console.log("Petición recibida para /noticias");
  // (Asegúrate de tener una tabla 'noticias' con 'id', 'titulo', 'imagen_url', 'enlace_url')
  const query = 'SELECT id, titulo, imagen_url, enlace_url FROM noticias ORDER BY id DESC LIMIT 5';
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al consultar noticias:', err);
      return res.status(500).json({ status: 'error', message: 'Error del servidor al buscar noticias' });
    }
    console.log(`Enviando ${results.length} noticias.`);
    const noticiasFormateadas = results.map(noticia => ({
        id: noticia.id,
        title: noticia.titulo,
        imageUrl: noticia.imagen_url,
        linkUrl: noticia.enlace_url
    }));
    res.json({ status: 'success', noticias: noticiasFormateadas });
  });
});
// --- FIN RUTA NOTICIAS ---

// --- **NUEVA RUTA**: OBTENER CURSOS DE UN USUARIO ---
app.get('/cursos/:usuarioId', (req, res) => {
  const usuarioId = req.params.usuarioId;
  console.log(`Petición recibida para /cursos/${usuarioId}`);
  // Obtiene los cursos únicos de las reglas de horario del usuario
  const query = `
    SELECT DISTINCT
      c.id as curso_id,
      c.nombre_curso,
      -- Toma un aula de ejemplo (la primera que encuentra, o 'virtual' si es NULL)
      COALESCE(MAX(r.aula), 'virtual') as aula
    FROM reglas_horario r
    JOIN cursos c ON r.curso_id = c.id
    WHERE r.usuario_id = ?
    GROUP BY c.id, c.nombre_curso -- Agrupa por curso
    ORDER BY c.nombre_curso;
  `;
  db.query(query, [usuarioId], (err, results) => {
    if (err) {
      console.error('Error al consultar cursos del usuario:', err);
      return res.status(500).json({ status: 'error', message: 'Error del servidor al buscar cursos' });
    }
    console.log(`Enviando ${results.length} cursos para el usuario.`);
    const cursosFormateadas = results.map(curso => ({
        id: curso.curso_id,
        name: curso.nombre_curso,
        location: curso.aula
    }));
    res.json({ status: 'success', cursos: cursosFormateados });
  });
});
// --- FIN RUTA CURSOS ---

// 10. Encender el servidor
// Railway te da el puerto a través de process.env.PORT
// Si no existe (para pruebas locales), usa 3000
const PORT = process.env.PORT || 3000; 

app.listen(PORT, () => {
  console.log(`*** Servidor API (Mesero) corriendo en el puerto ${PORT} ***`);
});