
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const robotManager = require('./robotManager');
const emailNotifier = require('./emailNotifier');
const expressWs = require('express-ws');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const wsInstance = expressWs(app);
const PORT = 3000;

// Configurar Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Función para generar descripción detallada con Gemini AI
async function generarDescripcionDetallada(waypointName, waypointDescription, tourName, tourDescription) {
    try {
        const prompt = `
Actúa como un guía turístico experto y genera una descripción detallada y atractiva para un waypoint de un tour robótico.

INFORMACIÓN DEL TOUR:
- Nombre del tour: ${tourName}
- Descripción del tour: ${tourDescription}

INFORMACIÓN DEL WAYPOINT:
- Nombre: ${waypointName}
- Descripción base: ${waypointDescription}

INSTRUCCIONES:
1. Genera una descripción detallada de 2-3 oraciones que sea informativa y atractiva
2. La descripción debe ser clara para síntesis de voz
3. Incluye datos interesantes o curiosidades si es posible
4. Mantén un tono amigable y educativo
5. La descripción debe durar aproximadamente 10-15 segundos cuando se lea en voz alta
6. Si no tienes información específica, crea una descripción general pero atractiva sobre el tipo de lugar
7. Tu objetivo es explicar que están viendo los usuarios en este momento en el museo

FORMATO DE RESPUESTA: Solo devuelve la descripción mejorada, sin introducciones ni explicaciones adicionales.
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const descripcionMejorada = response.text().trim();
        
        console.log(`✨ Gemini generó descripción para "${waypointName}": ${descripcionMejorada.substring(0, 100)}...`);
        return descripcionMejorada;
        
    } catch (error) {
        console.error('❌ Error con Gemini AI:', error.message);
        // Fallback a descripción original
        return waypointDescription || `Bienvenido a ${waypointName}. Este es un punto de interés importante en nuestro recorrido.`;
    }
}

// Cache para descripciones generadas (opcional - evita regenerar las mismas)
const descripcionesCache = new Map();

// Funciones auxiliares para gestión de estado de tours y robots
async function checkUserActiveStatus(userId) {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT id, tour_name, robot_id, robot_status, started_at
            FROM tour_history 
            WHERE user_id = ? AND completed = 0 
            ORDER BY started_at DESC 
            LIMIT 1
        `, [userId], (err, tour) => {
            if (err) return reject(err);
            resolve(tour || null);
        });
    });
}

async function checkRobotActiveStatus(robotId) {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT th.id, th.tour_name, th.user_id, u.username, th.started_at
            FROM tour_history th
            LEFT JOIN users u ON th.user_id = u.id
            WHERE th.robot_id = ? AND th.completed = 0 AND th.robot_status = 'in_progress'
            ORDER BY th.started_at DESC 
            LIMIT 1
        `, [robotId], (err, tour) => {
            if (err) return reject(err);
            resolve(tour || null);
        });
    });
}

async function assignRobotToTour(tourHistoryId, robotId) {
    return new Promise((resolve, reject) => {
        db.run(`
            UPDATE tour_history 
            SET robot_id = ?, robot_status = 'in_progress' 
            WHERE id = ?
        `, [robotId, tourHistoryId], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}

async function completeRobotTour(tourHistoryId) {
    return new Promise((resolve, reject) => {
        db.run(`
            UPDATE tour_history 
            SET completed = 1, robot_status = 'completed' 
            WHERE id = ?
        `, [tourHistoryId], function(err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
}


// Configuración de middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Servir archivos de uploads estáticamente
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generar nombre único: timestamp + id_usuario + extensión original
        const ext = path.extname(file.originalname);
        const fileName = `profile_${req.session.userId}_${Date.now()}${ext}`;
        cb(null, fileName);
    }
});

// Filtro para solo permitir imágenes
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos de imagen'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB máximo
    }
});

// Configuración de sesiones
app.use(session({
    secret: 'mi-secreto-super-seguro',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// Inicializar base de datos SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error al conectar con la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite');
    }
});

// Crear tabla de usuarios si no existe
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Añadir columna role a usuarios existentes (si no existe)
db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error al añadir columna role:', err.message);
    }
});

// Añadir columna profile_picture a usuarios existentes (si no existe)
db.run(`ALTER TABLE users ADD COLUMN profile_picture TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error al añadir columna profile_picture:', err.message);
    }
});

// Crear usuario admin por defecto si no existe
db.get('SELECT * FROM users WHERE role = ?', ['admin'], async (err, admin) => {
    if (err) {
        console.error('Error al verificar admin:', err);
        return;
    }
    
    if (!admin) {
        try {
            const bcrypt = require('bcrypt');
            const adminPassword = await bcrypt.hash('admin123', 10);
            db.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', 
                ['admin', 'admin@arttec.com', adminPassword, 'admin'], 
                function(err) {
                    if (err) {
                        console.error('Error al crear admin:', err);
                    } else {
                        console.log('✅ Usuario admin creado - User: admin, Pass: admin123');
                    }
                }
            );
        } catch (error) {
            console.error('Error al crear contraseña admin:', error);
        }
    }
});

// Crear usuario técnico por defecto si no existe
db.get('SELECT * FROM users WHERE role = ?', ['tecnico'], async (err, tecnico) => {
    if (err) {
        console.error('Error al verificar técnico:', err);
        return;
    }
    
    if (!tecnico) {
        try {
            const bcrypt = require('bcrypt');
            const tecnicoPassword = await bcrypt.hash('tecnico123', 10);
            db.run('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', 
                ['tecnico', 'tecnico@arttec.com', tecnicoPassword, 'tecnico'], 
                function(err) {
                    if (err) {
                        console.error('Error al crear técnico:', err);
                    } else {
                        console.log('✅ Usuario técnico creado - User: tecnico, Pass: tecnico123');
                    }
                }
            );
        } catch (error) {
            console.error('Error al crear contraseña técnico:', error);
        }
    }
});

// Crear tabla de rutas de tours
db.run(`CREATE TABLE IF NOT EXISTS tour_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    duration INTEGER NOT NULL,
    languages TEXT,
    icon TEXT,
    price DECIMAL(10,2),
    is_active BOOLEAN DEFAULT 1,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users (id)
)`);

// Crear tabla de historial de tours realizados
db.run(`CREATE TABLE IF NOT EXISTS tour_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tour_route_id INTEGER,
    tour_type TEXT NOT NULL,
    tour_name TEXT NOT NULL,
    tour_id TEXT NOT NULL,
    pin TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed BOOLEAN DEFAULT 0,
    rating INTEGER,
    feedback TEXT,
    robot_id TEXT,
    robot_status TEXT DEFAULT 'pending',
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (tour_route_id) REFERENCES tour_routes (id)
)`);

// Crear tabla de waypoints para los tours
db.run(`CREATE TABLE IF NOT EXISTS tour_waypoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_route_id INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    z REAL DEFAULT 0,
    sequence_order INTEGER NOT NULL,
    waypoint_type TEXT DEFAULT 'navigation',
    name TEXT NOT NULL DEFAULT '',
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tour_route_id) REFERENCES tour_routes (id) ON DELETE CASCADE
)`);

// Añadir columna name a waypoints existentes (si no existe)
db.run(`ALTER TABLE tour_waypoints ADD COLUMN name TEXT DEFAULT ''`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error al añadir columna name a tour_waypoints:', err.message);
    } else {
        // Migrar datos existentes: extraer nombres de descriptions que tengan formato "Nombre: Descripción"
        db.all('SELECT id, description FROM tour_waypoints WHERE name IS NULL OR name = ""', [], (err, waypoints) => {
            if (err) {
                console.error('Error al obtener waypoints para migración:', err);
                return;
            }
            
            if (waypoints.length > 0) {
                console.log(`🔄 Migrando ${waypoints.length} waypoints existentes...`);
                
                waypoints.forEach(wp => {
                    let name = '';
                    let description = wp.description || '';
                    
                    if (description.includes(': ')) {
                        const parts = description.split(': ');
                        name = parts[0].trim();
                        description = parts.slice(1).join(': ').trim();
                    } else {
                        name = description || `Waypoint ${wp.id}`;
                        description = '';
                    }
                    
                    db.run('UPDATE tour_waypoints SET name = ?, description = ? WHERE id = ?', 
                        [name, description, wp.id], 
                        function(updateErr) {
                            if (updateErr) {
                                console.error(`Error al migrar waypoint ${wp.id}:`, updateErr);
                            }
                        }
                    );
                });
                
                console.log('✅ Migración de waypoints completada');
            }
        });
    }
});

// Añadir columnas de robot a tour_history (si no existen)
db.run(`ALTER TABLE tour_history ADD COLUMN robot_id TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error al añadir columna robot_id:', err.message);
    }
});

db.run(`ALTER TABLE tour_history ADD COLUMN robot_status TEXT DEFAULT 'pending'`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('Error al añadir columna robot_status:', err.message);
    }
});

// Crear tabla de robots
db.run(`CREATE TABLE IF NOT EXISTS robots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'active',
    last_connection DATETIME,
    tours_completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`, (err) => {
    if (err) {
        console.error('Error al crear tabla robots:', err.message);
    } else {  
        // Insertar robots por defecto si la tabla está vacía
        db.get('SELECT COUNT(*) as count FROM robots', [], (err, row) => {
            if (err) {
                console.error('Error al verificar robots:', err);
            } else if (row.count === 0) {
                const defaultRobots = [
                    { name: 'Robot-A', status: 'active' },
                    { name: 'Robot-B', status: 'active' },
                    { name: 'TurtleBot-01', status: 'maintenance' }
                ];

                const stmt = db.prepare(`INSERT INTO robots (name, status) VALUES (?, ?)`);
                defaultRobots.forEach(robot => {
                    stmt.run([robot.name, robot.status]);
                });
                stmt.finalize();
                console.log('✅ Robots por defecto insertados');
            }
        });
    }
});

// Crear tabla de zonas para el mapa
db.run(`CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    x REAL, -- Legacy: para compatibilidad con zonas rectangulares
    y REAL, -- Legacy: para compatibilidad con zonas rectangulares
    width REAL, -- Legacy: para compatibilidad con zonas rectangulares
    height REAL, -- Legacy: para compatibilidad con zonas rectangulares
    points TEXT, -- JSON string con array de 4 puntos [{x, y}, {x, y}, {x, y}, {x, y}]
    type TEXT DEFAULT 'polygon', -- 'rectangle' o 'polygon'
    color TEXT NOT NULL DEFAULT '#ff4444',
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users (id)
)`, (err) => {
    if (err) {
        console.error('Error creando tabla zones:', err);
    } else {
        // Migración: agregar columnas nuevas si no existen
        db.run(`ALTER TABLE zones ADD COLUMN points TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Error agregando columna points:', err);
            }
        });
        
        db.run(`ALTER TABLE zones ADD COLUMN type TEXT DEFAULT 'polygon'`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Error agregando columna type:', err);
            }
        });

        db.run(`ALTER TABLE zones ADD COLUMN description TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Error agregando columna description:', err);
            }
        });

        db.run(`ALTER TABLE zones ADD COLUMN polygon TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Error agregando columna polygon:', err);
            }
        });

        db.run(`ALTER TABLE zones ADD COLUMN bounds TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Error agregando columna bounds:', err);
            }
        });
    }
});

// Middleware para verificar autenticación
function requireAuth(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        // Si es una petición de API, devolver JSON
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        // Si es una página, redirigir
        res.redirect('/login');
    }
}

// Middleware para verificar permisos de administrador
function requireAdmin(req, res, next) {
    if (!req.session.userId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        return res.redirect('/login');
    }
    
    // Verificar que el usuario sea admin
    db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos' });
        }
        
        if (!user || user.role !== 'admin') {
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ error: 'Acceso denegado - Se requieren permisos de administrador' });
            }
            return res.status(403).send('Acceso denegado - Se requieren permisos de administrador');
        }
        
        next();
    });
}

// Middleware para verificar permisos de técnico o administrador
function requireTechOrAdmin(req, res, next) {
    if (!req.session.userId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        return res.redirect('/login');
    }
    
    // Verificar que el usuario sea técnico o admin
    db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos' });
        }
        
        if (!user || (user.role !== 'admin' && user.role !== 'tecnico')) {
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ error: 'Acceso denegado - Se requieren permisos de técnico o administrador' });
            }
            return res.status(403).send('Acceso denegado - Se requieren permisos de técnico o administrador');
        }
        
        next();
    });
}

// Middleware específico solo para administradores (excluye técnicos)
function requireAdminOnly(req, res, next) {
    if (!req.session.userId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'No autorizado' });
        }
        return res.redirect('/login');
    }
    
    // Verificar que el usuario sea admin (excluyendo técnico)
    db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos' });
        }
        
        if (!user || user.role !== 'admin') {
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ error: 'Acceso denegado - Se requieren permisos exclusivos de administrador' });
            }
            return res.status(403).send('Acceso denegado - Se requieren permisos exclusivos de administrador');
        }
        
        next();
    });
}

// Rutas

// Página principal (índice)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Página de login
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Página de registro
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// ========== RUTAS ADMINISTRATIVAS (OCULTAS) ==========

// Panel de administración (solo admin - gestión de usuarios y protección de datos)
app.get('/admin', requireAdminOnly, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Página de estadísticas (solo admin - protección de datos)
app.get('/stats', requireAdminOnly, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stats.html'));
});

// Panel de notificaciones (acceso para técnicos y admins)
app.get('/notifications', requireTechOrAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'notifications.html'));
});

// API para obtener todas las rutas (solo admin)
app.get('/api/admin/routes', requireTechOrAdmin, (req, res) => {
    db.all('SELECT * FROM tour_routes ORDER BY created_at DESC', (err, routes) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener rutas' });
        }
        res.json(routes);
    });
});

// API para crear nueva ruta (solo admin)
app.post('/api/admin/routes', requireTechOrAdmin, (req, res) => {
    const { name, description, duration, languages, icon, price } = req.body;
    
    if (!name || !duration) {
        return res.status(400).json({ error: 'Nombre y duración son requeridos' });
    }
    
    db.run(
        'INSERT INTO tour_routes (name, description, duration, languages, icon, price, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, description, duration, languages, icon, price, req.session.userId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Error al crear ruta' });
            }
            
            // Obtener información del admin que creó la ruta
            db.get('SELECT username FROM users WHERE id = ?', [req.session.userId], (err, user) => {
                if (!err && user) {
                    // Contar waypoints si hay información adicional
                    const waypointCount = 0; // Aquí podrías contar waypoints reales si tienes esa información
                    
                    // Enviar notificación de ruta creada
                    emailNotifier.sendNotification('ROUTE_CREATED', {
                        routeName: name,
                        waypointCount: waypointCount,
                        createdBy: user.username
                    });
                }
            });
            
            res.json({ success: true, routeId: this.lastID });
        }
    );
});

// API para eliminar ruta (solo admin)
app.delete('/api/admin/routes/:id', requireTechOrAdmin, (req, res) => {
    const routeId = req.params.id;
    
    // Obtener información de la ruta antes de eliminarla
    db.get('SELECT name FROM tour_routes WHERE id = ?', [routeId], (err, route) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener ruta' });
        }
        
        if (!route) {
            return res.status(404).json({ error: 'Ruta no encontrada' });
        }
        
        // Contar tours afectados
        db.get('SELECT COUNT(*) as count FROM tour_history WHERE tour_route_id = ?', [routeId], (err, countResult) => {
            const toursCount = countResult ? countResult.count : 0;
            
            // Eliminar la ruta
            db.run('DELETE FROM tour_routes WHERE id = ?', [routeId], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Error al eliminar ruta' });
                }
                
                // Obtener información del admin que eliminó la ruta
                db.get('SELECT username FROM users WHERE id = ?', [req.session.userId], (err, user) => {
                    if (!err && user) {
                        // Enviar notificación de ruta eliminada
                        emailNotifier.sendNotification('ROUTE_DELETED', {
                            routeName: route.name,
                            toursCount: toursCount,
                            deletedBy: user.username
                        });
                    }
                });
                
                res.json({ success: true });
            });
        });
    });
});

// API para obtener estadísticas generales del admin (Solo Administradores)
app.get('/api/admin/stats', requireAdminOnly, (req, res) => {
    const stats = {};
    
    // Estadísticas de usuarios
    db.get(`
        SELECT 
            COUNT(*) as total_users,
            COUNT(CASE WHEN created_at >= date('now', '-30 days') THEN 1 END) as new_users_month,
            COUNT(CASE WHEN created_at >= date('now', '-7 days') THEN 1 END) as new_users_week,
            COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_users,
            COUNT(CASE WHEN role = 'user' THEN 1 END) as regular_users
        FROM users
    `, (err, userStats) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener estadísticas de usuarios' });
        }
        
        stats.users = userStats;
        
        // Estadísticas de tours
        db.get(`
            SELECT 
                COUNT(*) as total_tours,
                COUNT(CASE WHEN completed = 1 THEN 1 END) as completed_tours,
                COUNT(CASE WHEN completed = 0 THEN 1 END) as active_tours,
                COUNT(CASE WHEN started_at >= date('now', '-30 days') THEN 1 END) as tours_this_month,
                COUNT(CASE WHEN started_at >= date('now', '-7 days') THEN 1 END) as tours_this_week,
                AVG(CASE WHEN rating IS NOT NULL THEN rating END) as avg_rating,
                COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as total_ratings
            FROM tour_history
        `, (err, tourStats) => {
            if (err) {
                return res.status(500).json({ error: 'Error al obtener estadísticas de tours' });
            }
            
            stats.tours = tourStats;
            
            // Estadísticas de rutas disponibles
            db.get(`
                SELECT COUNT(*) as total_routes
                FROM tour_routes
            `, (err, routeStats) => {
                if (err) {
                    return res.status(500).json({ error: 'Error al obtener estadísticas de rutas' });
                }
                
                stats.routes = routeStats;
                
                // Estadísticas de engagement (usuarios que han completado al menos un tour)
                db.get(`
                    SELECT 
                        COUNT(DISTINCT user_id) as active_users,
                        COUNT(DISTINCT CASE WHEN started_at >= date('now', '-30 days') THEN user_id END) as active_users_month
                    FROM tour_history
                    WHERE completed = 1
                `, (err, engagementStats) => {
                    if (err) {
                        return res.status(500).json({ error: 'Error al obtener estadísticas de engagement' });
                    }
                    
                    stats.engagement = engagementStats;
                    res.json(stats);
                });
            });
        });
    });
});

// API para obtener estadísticas detalladas por período (Solo Administradores)
app.get('/api/admin/stats/monthly', requireAdminOnly, (req, res) => {
    const queries = {
        // Registros de usuarios por mes
        userRegistrations: `
            SELECT 
                strftime('%Y-%m', created_at) as month,
                COUNT(*) as count
            FROM users 
            WHERE created_at >= date('now', '-12 months')
            GROUP BY strftime('%Y-%m', created_at)
            ORDER BY month ASC
        `,
        
        // Tours iniciados por mes
        toursStarted: `
            SELECT 
                strftime('%Y-%m', started_at) as month,
                COUNT(*) as count
            FROM tour_history 
            WHERE started_at >= date('now', '-12 months')
            GROUP BY strftime('%Y-%m', started_at)
            ORDER BY month ASC
        `,
        
        // Tours completados por mes
        toursCompleted: `
            SELECT 
                strftime('%Y-%m', started_at) as month,
                COUNT(*) as count
            FROM tour_history 
            WHERE completed = 1 AND started_at >= date('now', '-12 months')
            GROUP BY strftime('%Y-%m', started_at)
            ORDER BY month ASC
        `,
        
        // Ratings promedio por mes
        monthlyRatings: `
            SELECT 
                strftime('%Y-%m', started_at) as month,
                AVG(rating) as avg_rating,
                COUNT(rating) as total_ratings
            FROM tour_history 
            WHERE rating IS NOT NULL AND started_at >= date('now', '-12 months')
            GROUP BY strftime('%Y-%m', started_at)
            ORDER BY month ASC
        `
    };
    
    const results = {};
    let completedQueries = 0;
    const totalQueries = Object.keys(queries).length;
    
    Object.entries(queries).forEach(([key, query]) => {
        db.all(query, (err, data) => {
            if (err) {
                return res.status(500).json({ error: `Error al obtener ${key}` });
            }
            
            results[key] = data;
            completedQueries++;
            
            if (completedQueries === totalQueries) {
                res.json(results);
            }
        });
    });
});

// API para obtener análisis de rendimiento de rutas
app.get('/api/admin/stats/routes-performance', requireAdminOnly, (req, res) => {
    const query = `
        SELECT 
            tr.id,
            tr.name,
            tr.icon,
            tr.description,
            COUNT(th.id) as total_tours,
            COUNT(CASE WHEN th.completed = 1 THEN 1 END) as completed_tours,
            COUNT(CASE WHEN th.completed = 0 THEN 1 END) as abandoned_tours,
            ROUND(
                (COUNT(CASE WHEN th.completed = 1 THEN 1 END) * 100.0) / 
                NULLIF(COUNT(th.id), 0), 2
            ) as completion_rate,
            AVG(CASE WHEN th.rating IS NOT NULL THEN th.rating END) as avg_rating,
            COUNT(CASE WHEN th.rating IS NOT NULL THEN 1 END) as total_ratings,
            COUNT(CASE WHEN th.started_at >= date('now', '-30 days') THEN 1 END) as tours_last_month,
            COUNT(CASE WHEN th.started_at >= date('now', '-7 days') THEN 1 END) as tours_last_week
        FROM tour_routes tr
        LEFT JOIN tour_history th ON tr.id = th.tour_route_id
        GROUP BY tr.id, tr.name, tr.icon, tr.description
        ORDER BY total_tours DESC
    `;
    
    db.all(query, (err, routesPerformance) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener rendimiento de rutas' });
        }
        res.json(routesPerformance);
    });
});

// API para obtener análisis de comportamiento de usuarios
app.get('/api/admin/stats/user-behavior', requireAdminOnly, (req, res) => {
    const queries = {
        // Distribución de usuarios por número de tours completados
        userDistribution: `
            SELECT 
                CASE 
                    WHEN tour_count = 0 THEN 'Sin tours'
                    WHEN tour_count = 1 THEN '1 tour'
                    WHEN tour_count <= 3 THEN '2-3 tours'
                    WHEN tour_count <= 5 THEN '4-5 tours'
                    WHEN tour_count <= 10 THEN '6-10 tours'
                    ELSE 'Más de 10 tours'
                END as category,
                COUNT(*) as user_count
            FROM (
                SELECT 
                    u.id,
                    COUNT(CASE WHEN th.completed = 1 THEN 1 END) as tour_count
                FROM users u
                LEFT JOIN tour_history th ON u.id = th.user_id
                GROUP BY u.id
            ) user_tours
            GROUP BY category
            ORDER BY 
                CASE category
                    WHEN 'Sin tours' THEN 1
                    WHEN '1 tour' THEN 2
                    WHEN '2-3 tours' THEN 3
                    WHEN '4-5 tours' THEN 4
                    WHEN '6-10 tours' THEN 5
                    ELSE 6
                END
        `,
        
        // Usuarios más activos
        topUsers: `
            SELECT 
                u.username,
                u.email,
                u.created_at,
                COUNT(th.id) as total_tours,
                COUNT(CASE WHEN th.completed = 1 THEN 1 END) as completed_tours,
                AVG(CASE WHEN th.rating IS NOT NULL THEN th.rating END) as avg_rating,
                MAX(th.started_at) as last_tour_date
            FROM users u
            LEFT JOIN tour_history th ON u.id = th.user_id
            WHERE u.role != 'admin'
            GROUP BY u.id, u.username, u.email, u.created_at
            HAVING total_tours > 0
            ORDER BY completed_tours DESC, total_tours DESC
            LIMIT 20
        `,
        
        // Análisis de retención (usuarios que volvieron después de su primer tour)
        retention: `
            SELECT 
                COUNT(DISTINCT CASE WHEN tour_count = 1 THEN user_id END) as single_tour_users,
                COUNT(DISTINCT CASE WHEN tour_count > 1 THEN user_id END) as returning_users,
                COUNT(DISTINCT user_id) as total_active_users
            FROM (
                SELECT 
                    user_id,
                    COUNT(*) as tour_count
                FROM tour_history
                WHERE completed = 1
                GROUP BY user_id
            ) user_activity
        `
    };
    
    const results = {};
    let completedQueries = 0;
    const totalQueries = Object.keys(queries).length;
    
    Object.entries(queries).forEach(([key, query]) => {
        db.all(query, (err, data) => {
            if (err) {
                return res.status(500).json({ error: `Error al obtener ${key}` });
            }
            
            results[key] = data;
            completedQueries++;
            
            if (completedQueries === totalQueries) {
                res.json(results);
            }
        });
    });
});

// API para obtener análisis de satisfacción y ratings
app.get('/api/admin/stats/satisfaction', requireAdminOnly, (req, res) => {
    const queries = {
        // Distribución de ratings
        ratingDistribution: `
            SELECT 
                rating,
                COUNT(*) as count,
                ROUND((COUNT(*) * 100.0) / (SELECT COUNT(*) FROM tour_history WHERE rating IS NOT NULL), 1) as percentage
            FROM tour_history
            WHERE rating IS NOT NULL
            GROUP BY rating
            ORDER BY rating DESC
        `,
        
        // Ratings por ruta
        ratingsByRoute: `
            SELECT 
                tr.name as route_name,
                tr.icon,
                COUNT(th.rating) as total_ratings,
                AVG(th.rating) as avg_rating,
                COUNT(CASE WHEN th.rating = 5 THEN 1 END) as five_stars,
                COUNT(CASE WHEN th.rating = 4 THEN 1 END) as four_stars,
                COUNT(CASE WHEN th.rating <= 3 THEN 1 END) as low_ratings
            FROM tour_routes tr
            LEFT JOIN tour_history th ON tr.id = th.tour_route_id AND th.rating IS NOT NULL
            GROUP BY tr.id, tr.name, tr.icon
            HAVING total_ratings > 0
            ORDER BY avg_rating DESC, total_ratings DESC
        `,
        
        // Comentarios recientes (últimos 50)
        recentFeedback: `
            SELECT 
                u.username,
                tr.name as route_name,
                th.rating,
                th.feedback,
                th.started_at
            FROM tour_history th
            JOIN users u ON th.user_id = u.id
            JOIN tour_routes tr ON th.tour_route_id = tr.id
            WHERE th.feedback IS NOT NULL AND th.feedback != ''
            ORDER BY th.started_at DESC
            LIMIT 50
        `
    };
    
    const results = {};
    let completedQueries = 0;
    const totalQueries = Object.keys(queries).length;
    
    Object.entries(queries).forEach(([key, query]) => {
        db.all(query, (err, data) => {
            if (err) {
                return res.status(500).json({ error: `Error al obtener ${key}` });
            }
            
            results[key] = data;
            completedQueries++;
            
            if (completedQueries === totalQueries) {
                res.json(results);
            }
        });
    });
});

// API para obtener métricas de tiempo real y tendencias
app.get('/api/admin/stats/realtime', requireAdminOnly, (req, res) => {
    const queries = {
        // Actividad hoy
        todayActivity: `
            SELECT 
                COUNT(CASE WHEN created_at >= date('now', 'localtime') THEN 1 END) as new_users_today,
                COUNT(CASE WHEN started_at >= date('now', 'localtime') THEN 1 END) as tours_started_today,
                COUNT(CASE WHEN completed = 1 AND started_at >= date('now', 'localtime') THEN 1 END) as tours_completed_today
            FROM users u
            FULL OUTER JOIN tour_history th ON 1=1
        `,
        
        // Actividad de la semana
        weekActivity: `
            SELECT 
                strftime('%w', started_at) as day_of_week,
                CASE strftime('%w', started_at)
                    WHEN '0' THEN 'Domingo'
                    WHEN '1' THEN 'Lunes'
                    WHEN '2' THEN 'Martes'
                    WHEN '3' THEN 'Miércoles'
                    WHEN '4' THEN 'Jueves'
                    WHEN '5' THEN 'Viernes'
                    WHEN '6' THEN 'Sábado'
                END as day_name,
                COUNT(*) as tour_count
            FROM tour_history
            WHERE started_at >= date('now', '-7 days')
            GROUP BY strftime('%w', started_at)
            ORDER BY day_of_week
        `,
        
        // Tours activos (no completados)
        activeTours: `
            SELECT 
                COUNT(*) as active_tours_count,
                COUNT(CASE WHEN started_at >= date('now', '-1 days') THEN 1 END) as started_today,
                COUNT(CASE WHEN started_at < date('now', '-1 days') THEN 1 END) as older_tours
            FROM tour_history
            WHERE completed = 0
        `,
        
        // Tendencia de crecimiento (comparación con período anterior)
        growthTrends: `
            SELECT 
                COUNT(CASE WHEN created_at >= date('now', '-30 days') THEN 1 END) as users_this_month,
                COUNT(CASE WHEN created_at >= date('now', '-60 days') AND created_at < date('now', '-30 days') THEN 1 END) as users_last_month,
                COUNT(CASE WHEN started_at >= date('now', '-30 days') THEN 1 END) as tours_this_month,
                COUNT(CASE WHEN started_at >= date('now', '-60 days') AND started_at < date('now', '-30 days') THEN 1 END) as tours_last_month
            FROM users u
            FULL OUTER JOIN tour_history th ON 1=1
        `
    };
    
    const results = {};
    let completedQueries = 0;
    const totalQueries = Object.keys(queries).length;
    
    Object.entries(queries).forEach(([key, query]) => {
        db.all(query, (err, data) => {
            if (err) {
                return res.status(500).json({ error: `Error al obtener ${key}` });
            }
            
            results[key] = key === 'todayActivity' || key === 'activeTours' || key === 'growthTrends' ? data[0] : data;
            completedQueries++;
            
            if (completedQueries === totalQueries) {
                res.json(results);
            }
        });
    });
});

// API para obtener lista de usuarios (Solo Administradores)
app.get('/api/admin/users', requireAdminOnly, (req, res) => {
    const query = `
        SELECT u.id, u.username, u.email, u.role, u.created_at,
               COUNT(th.id) as tours_completed,
               MAX(th.started_at) as last_tour_date
        FROM users u
        LEFT JOIN tour_history th ON u.id = th.user_id
        GROUP BY u.id, u.username, u.email, u.role, u.created_at
        ORDER BY u.created_at DESC
    `;
    
    db.all(query, (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener usuarios' });
        }
        res.json(users);
    });
});

// API para obtener historial de tours de un usuario
app.get('/api/admin/users/:id/tours', requireAdminOnly, (req, res) => {
    const userId = req.params.id;
    
    const query = `
        SELECT th.*, tr.name as route_name, tr.icon as route_icon
        FROM tour_history th
        LEFT JOIN tour_routes tr ON th.tour_route_id = tr.id
        WHERE th.user_id = ?
        ORDER BY th.started_at DESC
    `;
    
    db.all(query, [userId], (err, tours) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener historial de tours' });
        }
        res.json(tours);
    });
});

// API para cambiar rol de usuario
app.put('/api/admin/users/:id/role', requireAdminOnly, (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;
    
    if (!['user', 'tecnico', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Rol inválido' });
    }
    
    db.run('UPDATE users SET role = ? WHERE id = ?', [role, userId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Error al actualizar rol' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.json({ success: true, message: 'Rol actualizado exitosamente' });
    });
});

// API para eliminar usuario
app.delete('/api/admin/users/:id', requireAdminOnly, (req, res) => {
    const userId = req.params.id;
    
    // No permitir eliminar el propio usuario admin
    if (parseInt(userId) === req.session.userId) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }
    
    // Obtener datos del usuario antes de eliminarlo
    db.get('SELECT username, email FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener usuario' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Primero eliminar historial de tours
        db.run('DELETE FROM tour_history WHERE user_id = ?', [userId], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Error al eliminar historial' });
            }
            
            // Luego eliminar usuario
            db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Error al eliminar usuario' });
                }
                
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Usuario no encontrado' });
                }
                
                // Enviar notificación de eliminación de usuario
                emailNotifier.sendNotification('USER_DELETED', {
                    username: user.username,
                    email: user.email
                });
                
                res.json({ success: true, message: 'Usuario eliminado exitosamente' });
            });
        });
    });
});

// API para resetear contraseña de usuario
app.put('/api/admin/users/:id/password', requireAdminOnly, async (req, res) => {
    const userId = req.params.id;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Error al actualizar contraseña' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }
            
            res.json({ success: true, message: 'Contraseña actualizada exitosamente' });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al procesar contraseña' });
    }
});

// ========== FIN RUTAS ADMINISTRATIVAS ==========

// API para iniciar un tour
app.post('/api/start-tour', requireAuth, (req, res) => {
    const { tourId, robot } = req.body;
    
    if (!tourId) {
        return res.status(400).json({ error: 'ID de tour requerido' });
    }

    if (!robot || !robot.trim()) {
        return res.status(400).json({ error: 'Robot requerido' });
    }

    const robotName = robot.trim();

    // Verificar que el tour existe y está activo
    db.get('SELECT * FROM tour_routes WHERE id = ? AND is_active = 1', [tourId], (err, tour) => {
        if (err) {
            console.error('Error al verificar tour:', err);
            return res.status(500).json({ error: 'Error al verificar tour' });
        }
        
        if (!tour) {
            return res.status(404).json({ error: 'Tour no encontrado o no disponible' });
        }

        // Verificar disponibilidad del robot
        checkRobotAvailability(robotName, (err, robotStatus) => {
            if (err) {
                console.error('Error al verificar disponibilidad del robot:', err);
                return res.status(400).json({ error: err.error });
            }

            // Si el robot no está disponible, preguntar si cancelar tour activo
            if (!robotStatus.isAvailable) {
                const activeTour = robotStatus.activeTour;
                const message = `Robot "${robotName}" ocupado con tour "${activeTour.tour_name}" del usuario "${activeTour.username}". Iniciado: ${new Date(activeTour.started_at).toLocaleString()}`;
                
                console.log(`⚠️ ${message}`);
                
                // Cancelar automáticamente el tour anterior y continuar
                cancelRobotActiveTour(robotName, `Nuevo tour iniciado por ${req.session.username || 'usuario'}`, (cancelErr, cancelledCount) => {
                    if (cancelErr) {
                        console.error('Error al cancelar tour anterior:', cancelErr);
                        return res.status(500).json({ error: 'Error al liberar robot' });
                    }

                    console.log(`✅ Robot "${robotName}" liberado. ${cancelledCount} tour(s) cancelado(s)`);
                    
                    // Enviar notificación del tour abandonado
                    if (activeTour) {
                        emailNotifier.sendNotification('TOUR_ABANDONED', {
                            tourName: activeTour.tour_name,
                            username: activeTour.username,
                            progress: 'Desconocido - Tour cancelado por conflicto de robot'
                        });
                    }

                    // Continuar con el nuevo tour
                    initializeNewTour();
                });
            } else {
                // Robot disponible, iniciar tour normalmente
                initializeNewTour();
            }

            function initializeNewTour() {
                // Generar ID único para esta instancia del tour y PIN
                const tourInstanceId = Math.random().toString(36).substr(2, 9);
                const PIN = Array.from({ length: 5 }, () => Math.floor(Math.random() * 3)).join('');

                // Guardar en historial de tours incluyendo robot_id
                db.run(
                    `INSERT INTO tour_history 
                     (user_id, tour_route_id, tour_type, tour_name, tour_id, pin, robot_id, robot_status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [req.session.userId, tourId, tour.name.toLowerCase().replace(/\s+/g, '-'), tour.name, tourInstanceId, PIN, robotName, 'pending'],
                    function(err) {
                        if (err) {
                            console.error('Error al guardar historial de tour:', err);
                            return res.status(500).json({ error: 'Error al iniciar tour' });
                        }
                        
                        // Obtener información del usuario para la notificación
                        db.get('SELECT username FROM users WHERE id = ?', [req.session.userId], (err, user) => {
                            if (!err && user) {
                                // Enviar notificación de tour iniciado
                                emailNotifier.sendNotification('TOUR_STARTED', {
                                    tourName: tour.name,
                                    username: user.username,
                                    routeName: tour.name,
                                    robotName: robotName
                                });
                            }
                        });
                        
                        console.log(`🎭 Tour "${tour.name}" iniciado por ${req.session.username || 'usuario'} con robot "${robotName}"`);
                        
                        res.json({ 
                            success: true, 
                            message: `Tour "${tour.name}" iniciado exitosamente con ${robotName}`,
                            tourId: tourInstanceId,
                            tourName: tour.name,
                            tourDescription: tour.description,
                            duration: tour.duration,
                            robotName: robotName,
                            PIN: PIN,
                            startTime: new Date().toISOString(),
                            robotStatus: 'assigned'
                        });
                    }
                );
            }
        });
    });
});

// API para login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario/Email y contraseña son requeridos' });
    }

    // Buscar por username o email
    db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos' });
        }

        if (!user) {
            return res.status(401).json({ error: 'Usuario/Email o contraseña incorrectos' });
        }

        try {
            const validPassword = await bcrypt.compare(password, user.password);
            if (validPassword) {
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.userRole = user.role;
                
                // Si es admin, redirigir al panel administrativo
                if (user.role === 'admin') {
                    res.json({ 
                        success: true, 
                        message: 'Login exitoso',
                        isAdmin: true,
                        redirectTo: '/admin'
                    });
                } else {
                    res.json({ success: true, message: 'Login exitoso' });
                }
            } else {
                res.status(401).json({ error: 'Usuario/Email o contraseña incorrectos' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Error al verificar contraseña' });
        }
    });
});

// API para registro
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', 
            [username, email, hashedPassword], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    res.status(400).json({ error: 'El usuario o email ya existe' });
                } else {
                    res.status(500).json({ error: 'Error al crear usuario' });
                }
            } else {
                // Enviar notificación de nuevo usuario
                emailNotifier.sendNotification('USER_CREATED', {
                    username: username,
                    email: email,
                    role: 'user'
                });
                res.json({ success: true, message: 'Usuario creado exitosamente' });
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al procesar la contraseña' });
    }
});

// API para obtener info del usuario
app.get('/api/user', requireAuth, (req, res) => {
    db.get('SELECT id, username, email, role, profile_picture, created_at FROM users WHERE id = ?', 
        [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos' });
        }
        res.json(user);
    });
});

// API para subir foto de perfil
app.post('/api/user/profile-picture', requireAuth, upload.single('profilePicture'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
    }

    const userId = req.session.userId;
    const filePath = `/uploads/${req.file.filename}`;

    // Obtener la imagen anterior para eliminarla
    db.get('SELECT profile_picture FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
            console.error('Error al obtener imagen anterior:', err);
        } else if (user && user.profile_picture) {
            // Eliminar imagen anterior si existe
            const oldImagePath = path.join(__dirname, 'public', user.profile_picture);
            if (fs.existsSync(oldImagePath)) {
                fs.unlink(oldImagePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error al eliminar imagen anterior:', unlinkErr);
                });
            }
            // También intentar eliminar del directorio uploads
            const oldUploadsPath = path.join(__dirname, user.profile_picture.replace('/uploads/', 'uploads/'));
            if (fs.existsSync(oldUploadsPath)) {
                fs.unlink(oldUploadsPath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error al eliminar imagen anterior:', unlinkErr);
                });
            }
        }

        // Actualizar la base de datos con la nueva imagen
        db.run('UPDATE users SET profile_picture = ? WHERE id = ?', [filePath, userId], function(updateErr) {
            if (updateErr) {
                console.error('Error al actualizar base de datos:', updateErr);
                return res.status(500).json({ error: 'Error al guardar la imagen en la base de datos' });
            }

            res.json({
                message: 'Foto de perfil actualizada correctamente',
                profilePicture: filePath
            });
        });
    });
});

// API para eliminar foto de perfil
app.delete('/api/user/profile-picture', requireAuth, (req, res) => {
    const userId = req.session.userId;

    // Obtener la imagen actual para eliminarla
    db.get('SELECT profile_picture FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos' });
        }

        if (user && user.profile_picture) {
            // Eliminar archivo de imagen
            const imagePath = path.join(__dirname, user.profile_picture.replace('/uploads/', 'uploads/'));
            if (fs.existsSync(imagePath)) {
                fs.unlink(imagePath, (unlinkErr) => {
                    if (unlinkErr) console.error('Error al eliminar imagen:', unlinkErr);
                });
            }

            // Actualizar base de datos
            db.run('UPDATE users SET profile_picture = NULL WHERE id = ?', [userId], function(updateErr) {
                if (updateErr) {
                    return res.status(500).json({ error: 'Error al actualizar la base de datos' });
                }

                res.json({ message: 'Foto de perfil eliminada correctamente' });
            });
        } else {
            res.json({ message: 'No hay foto de perfil para eliminar' });
        }
    });
});

// API para actualizar información del perfil
app.put('/api/user/profile', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { username, email } = req.body;

    // Validaciones básicas
    if (!username || !email) {
        return res.status(400).json({ error: 'Username y email son requeridos' });
    }

    if (username.length < 3) {
        return res.status(400).json({ error: 'El username debe tener al menos 3 caracteres' });
    }

    if (!email.includes('@')) {
        return res.status(400).json({ error: 'Email inválido' });
    }

    // Verificar que el username y email no estén en uso por otro usuario
    db.get('SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?', 
        [username, email, userId], (err, existingUser) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos' });
        }

        if (existingUser) {
            return res.status(400).json({ error: 'El username o email ya están en uso' });
        }

        // Actualizar información
        db.run('UPDATE users SET username = ?, email = ? WHERE id = ?', 
            [username, email, userId], function(updateErr) {
            if (updateErr) {
                return res.status(500).json({ error: 'Error al actualizar el perfil' });
            }

            res.json({ 
                message: 'Perfil actualizado correctamente',
                username: username,
                email: email
            });
        });
    });
});

// API para cambiar contraseña
app.put('/api/user/password', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const { currentPassword, newPassword } = req.body;

    // Validaciones
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Contraseña actual y nueva contraseña son requeridas' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    try {
        // Obtener contraseña actual del usuario
        db.get('SELECT password FROM users WHERE id = ?', [userId], async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Error en la base de datos' });
            }

            if (!user) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            // Verificar contraseña actual
            const validPassword = await bcrypt.compare(currentPassword, user.password);
            if (!validPassword) {
                return res.status(400).json({ error: 'Contraseña actual incorrecta' });
            }

            // Encriptar nueva contraseña
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Actualizar contraseña
            db.run('UPDATE users SET password = ? WHERE id = ?', 
                [hashedPassword, userId], function(updateErr) {
                if (updateErr) {
                    return res.status(500).json({ error: 'Error al actualizar la contraseña' });
                }

                res.json({ message: 'Contraseña actualizada correctamente' });
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// API para obtener tours realizados por el usuario
app.get('/api/user/tours', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.all(`
        SELECT 
            id,
            tour_name,
            tour_type,
            tour_id,
            pin,
            started_at,
            completed,
            rating,
            feedback,
            robot_id,
            robot_status
        FROM tour_history 
        WHERE user_id = ?
        ORDER BY started_at DESC
    `, [userId], (err, tours) => {
        if (err) {
            console.error('Error al obtener tours:', err);
            return res.status(500).json({ error: 'Error al obtener tours' });
        }
        
        // Formatear las fechas y estados
        const formattedTours = tours.map(tour => ({
            ...tour,
            completed: Boolean(tour.completed),
            started_at: tour.started_at,
            status: tour.completed ? 'Completado' : 'En progreso',
            robot_status: tour.robot_status || 'pending',
            has_robot: !!tour.robot_id
        }));
        
        res.json(formattedTours);
    });
});

// API para enviar rating y feedback de un tour
app.post('/api/tours/:tourId/rating', requireAuth, (req, res) => {
    const { tourId } = req.params;
    const { rating, feedback } = req.body;
    const userId = req.session.userId;
    
    // Validar rating
    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating debe ser entre 1 y 5' });
    }
    
    // Verificar que el tour pertenece al usuario y está completado
    db.get(`
        SELECT id, completed 
        FROM tour_history 
        WHERE id = ? AND user_id = ?
    `, [tourId, userId], (err, tour) => {
        if (err) {
            console.error('Error al verificar tour:', err);
            return res.status(500).json({ error: 'Error en la base de datos' });
        }
        
        if (!tour) {
            return res.status(404).json({ error: 'Tour no encontrado' });
        }
        
        if (!tour.completed) {
            return res.status(400).json({ error: 'Solo se pueden calificar tours completados' });
        }
        
        // Actualizar rating y feedback
        db.run(`
            UPDATE tour_history 
            SET rating = ?, feedback = ? 
            WHERE id = ? AND user_id = ?
        `, [rating, feedback || null, tourId, userId], function(err) {
            if (err) {
                console.error('Error al actualizar rating:', err);
                return res.status(500).json({ error: 'Error al guardar la valoración' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Tour no encontrado' });
            }
            
            res.json({ 
                success: true, 
                message: 'Valoración guardada correctamente',
                tourId,
                rating,
                feedback
            });
        });
    });
});

// API para completar un tour (depuración)
app.post('/api/tours/:tourId/complete', requireAuth, (req, res) => {
    const { tourId } = req.params;
    const userId = req.session.userId;
    
    // Verificar que el tour pertenece al usuario
    db.get(`
        SELECT id, completed 
        FROM tour_history 
        WHERE id = ? AND user_id = ?
    `, [tourId, userId], (err, tour) => {
        if (err) {
            console.error('Error al verificar tour:', err);
            return res.status(500).json({ error: 'Error en la base de datos' });
        }
        
        if (!tour) {
            return res.status(404).json({ error: 'Tour no encontrado' });
        }
        
        if (tour.completed) {
            return res.status(400).json({ error: 'El tour ya está completado' });
        }
        
        // Marcar tour como completado
        db.run(`
            UPDATE tour_history 
            SET completed = 1 
            WHERE id = ? AND user_id = ?
        `, [tourId, userId], function(err) {
            if (err) {
                console.error('Error al completar tour:', err);
                return res.status(500).json({ error: 'Error al completar el tour' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Tour no encontrado' });
            }
            
            res.json({ 
                success: true, 
                message: 'Tour marcado como completado',
                tourId
            });
        });
    });
});

// API para verificar PIN del robot (sin autenticación - para uso del robot)
app.post('/api/robot/start-tour', requireAuth, async (req, res) => {
    const { tour_id, robot_id } = req.body;
    const user_id = req.session.userId;
    
    if (!tour_id) {
        return res.status(400).json({ error: 'ID de tour requerido' });
    }

    if (!robot_id) {
        return res.status(400).json({ error: 'ID de robot requerido' });
    }

    try {
        // 1. Verificar que el usuario no tiene otro tour activo
        const userActiveTour = await checkUserActiveStatus(user_id);
        if (userActiveTour) {
            return res.status(409).json({ 
                error: 'Ya tienes un tour activo',
                details: `Tour "${userActiveTour.tour_name}" iniciado el ${new Date(userActiveTour.started_at).toLocaleString('es-ES')}`,
                activeTour: userActiveTour
            });
        }

        // 2. Verificar que el robot no esté ocupado
        const robotActiveTour = await checkRobotActiveStatus(robot_id);
        if (robotActiveTour) {
            return res.status(409).json({ 
                error: 'Robot ocupado',
                details: `El robot está ejecutando el tour "${robotActiveTour.tour_name}" para ${robotActiveTour.username}`,
                robotBusy: true
            });
        }

        // 3. Verificar que el tour existe y está activo
        db.get('SELECT * FROM tour_routes WHERE id = ? AND is_active = 1', [tour_id], async (err, tour) => {
            if (err) {
                console.error('Error al verificar tour:', err);
                return res.status(500).json({ error: 'Error al verificar tour' });
            }
            
            if (!tour) {
                return res.status(404).json({ error: 'Tour no encontrado o no disponible' });
            }

            // 4. Generar ID único para esta instancia del tour y PIN
            const tourInstanceId = Math.random().toString(36).substr(2, 9);
            const PIN = Array.from({ length: 5 }, () => Math.floor(Math.random() * 10)).join('');

            // 5. Guardar en historial de tours con robot asignado
            db.run(
                `INSERT INTO tour_history 
                 (user_id, tour_route_id, tour_type, tour_name, tour_id, pin, robot_id, robot_status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress')`,
                [user_id, tour_id, tour.name.toLowerCase().replace(/\s+/g, '-'), tour.name, tourInstanceId, PIN, robot_id],
                function(err) {
                    if (err) {
                        console.error('Error al guardar historial de tour:', err);
                        return res.status(500).json({ error: 'Error al iniciar tour' });
                    }
                    
                    const tourHistoryId = this.lastID;
                    
                    // 6. Obtener información del usuario y procesar waypoints
                    db.get('SELECT username, email FROM users WHERE id = ?', [user_id], async (err, user) => {
                        if (!err && user) {
                            // Enviar notificación de tour iniciado con robot
                            emailNotifier.sendNotification('ROBOT_TOUR_STARTED', {
                                tourName: tour.name,
                                username: user.username,
                                robotId: robot_id,
                                routeName: tour.name
                            });
                        }

                        // 7. Obtener waypoints del tour para enviar al robot
                        const waypointsQuery = `
                            SELECT * FROM tour_waypoints 
                            WHERE tour_route_id = ? 
                            ORDER BY sequence_order ASC
                        `;
                        
                        db.all(waypointsQuery, [tour_id], async (waypointsErr, waypoints) => {
                            if (waypointsErr) {
                                console.error('Error al obtener waypoints:', waypointsErr);
                                return res.status(500).json({ 
                                    success: false,
                                    error: 'Error al obtener información del tour' 
                                });
                            }
                            
                            console.log(`🔄 Procesando ${waypoints.length} waypoints con Gemini AI para robot ${robot_id}...`);
                            
                            // 8. Procesar waypoints con Gemini AI para generar descripciones detalladas
                            const waypointsConDescripciones = await Promise.all(
                                waypoints.map(async (wp) => {
                                    const waypointName = wp.name || `Waypoint ${wp.sequence_order}`;
                                    const waypointDescription = wp.description || '';
                                    
                                    // Crear clave de cache
                                    const cacheKey = `${tour_id}-${wp.id}-${waypointName}-${waypointDescription}`;
                                    
                                    let descripcionDetallada;
                                    if (descripcionesCache.has(cacheKey)) {
                                        descripcionDetallada = descripcionesCache.get(cacheKey);
                                        console.log(`📋 Usando descripción cacheada para "${waypointName}"`);
                                    } else {
                                        // Generar descripción con Gemini AI
                                        descripcionDetallada = await generarDescripcionDetallada(
                                            waypointName, 
                                            waypointDescription, 
                                            tour.name,
                                            tour.description || 'Un interesante recorrido turístico'
                                        );
                                        
                                        // Guardar en cache
                                        descripcionesCache.set(cacheKey, descripcionDetallada);
                                        console.log(`✨ Descripción generada para "${waypointName}"`);
                                    }
                                    
                                    return {
                                        ...wp,
                                        name: waypointName,
                                        ai_description: descripcionDetallada
                                    };
                                })
                            );
                            
                            // 9. Información completa del tour para el robot
                            const tourInfo = {
                                success: true,
                                valido: true,
                                tour: {
                                    id: tour_id,
                                    history_id: tourHistoryId,
                                    name: tour.name,
                                    description: tour.description,
                                    duration: tour.duration,
                                    pin: PIN,
                                    robot_id: robot_id,
                                    user_info: user || { username: 'Usuario', id: user_id }
                                },
                                waypoints: waypointsConDescripciones,
                                total_waypoints: waypointsConDescripciones.length,
                                message: `Tour "${tour.name}" iniciado correctamente para robot ${robot_id}`,
                                feedback: {
                                    type: 'robot_tour_started',
                                    description: `Tour iniciado con ${waypointsConDescripciones.length} waypoints para robot ${robot_id}`
                                }
                            };

                            // 10. Enviar datos del tour al robot
                            try {
                                robotManager.sendTourData(robot_id, {
                                    tour: {
                                        tour_id: tourInstanceId,
                                        name: tour.name,
                                        waypoints: [] // Se pueden obtener aquí si es necesario
                                    },
                                    pin_string: PIN,
                                    usuario: 'Usuario web'
                                });
                            } catch (error) {
                                console.log('⚠️  No se pudo enviar al robot via ROS:', error.message);
                            }
                            
                            console.log(`🤖 Tour "${tour.name}" iniciado para robot ${robot_id} - Usuario: ${user_id} - PIN: ${PIN}`);
                            
                            res.json({ 
                                success: true, 
                                message: `Tour "${tour.name}" iniciado correctamente para robot ${robot_id}`,
                                tourId: tourInstanceId,
                                tourHistoryId: tourHistoryId,
                                tourName: tour.name,
                                tourDescription: tour.description,
                                duration: tour.duration,
                                PIN: PIN,
                                robotId: robot_id,
                                startTime: new Date().toISOString(),
                                waypoints_count: waypointsConDescripciones.length,
                                status: 'robot_assigned'
                            });
                        });
                    });
                }
            );
        });
        
    } catch (error) {
        console.error('Error en start-tour:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// API para verificar estado del usuario (tours activos)
app.get('/api/user/status', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const activeTour = await checkUserActiveStatus(userId);
        
        res.json({
            userId: userId,
            hasActiveTour: !!activeTour,
            activeTour: activeTour,
            status: activeTour ? 'busy' : 'available'
        });
    } catch (error) {
        console.error('Error al verificar estado del usuario:', error);
        res.status(500).json({ error: 'Error al verificar estado' });
    }
});

// API para verificar estado del robot
app.get('/api/robot/:robotId/status', (req, res) => {
    const robotId = req.params.robotId;
    
    checkRobotActiveStatus(robotId)
        .then(activeTour => {
            res.json({
                robotId: robotId,
                isOccupied: !!activeTour,
                activeTour: activeTour,
                status: activeTour ? 'busy' : 'available'
            });
        })
        .catch(error => {
            console.error('Error al verificar estado del robot:', error);
            res.status(500).json({ error: 'Error al verificar estado del robot' });
        });
});

// API mejorada para completar tour con liberación de usuario y robot
app.post('/api/robot/tour/complete', async (req, res) => {
    const { tour_id, tour_history_id } = req.body;
    
    if (!tour_id && !tour_history_id) {
        return res.status(400).json({ 
            success: false,
            error: 'tour_id o tour_history_id son requeridos',
            received: req.body 
        });
    }
    
    try {
        let query, params;
        
        if (tour_history_id) {
            query = `
                SELECT th.*, tr.name as tour_name, tr.languages, tr.icon, tr.price, u.username
                FROM tour_history th
                LEFT JOIN tour_routes tr ON th.tour_route_id = tr.id
                LEFT JOIN users u ON th.user_id = u.id
                WHERE th.id = ? AND th.completed = 0
                LIMIT 1
            `;
            params = [tour_history_id];
        } else {
            query = `
                SELECT th.*, tr.name as tour_name, tr.languages, tr.icon, tr.price, u.username
                FROM tour_history th
                LEFT JOIN tour_routes tr ON th.tour_route_id = tr.id
                LEFT JOIN users u ON th.user_id = u.id
                WHERE th.tour_id = ? AND th.completed = 0
                LIMIT 1
            `;
            params = [tour_id];
        }
    
        db.get(query, params, async (err, tour) => {
            if (err) {
                console.error('Error al buscar tour:', err);
                return res.status(500).json({ 
                    success: false,
                    error: 'Error en la base de datos' 
                });
            }
            
            if (!tour) {
                return res.json({ 
                    success: false,
                    error: 'Tour no encontrado o ya completado',
                    tour_id: tour_id,
                    tour_history_id: tour_history_id
                });
            }
            
            // Completar el tour y liberar usuario/robot
            const success = await completeRobotTour(tour.id);
            
            if (success) {
                // Enviar notificación de tour completado
                if (tour.username) {
                    emailNotifier.sendNotification('TOUR_COMPLETED', {
                        tourName: tour.tour_name,
                        username: tour.username,
                        robotId: tour.robot_id || 'desconocido',
                        duration: tour.duration || 'No especificada',
                        completedAt: new Date().toLocaleString('es-ES')
                    });
                }
                
                console.log(`✅ Tour "${tour.tour_name}" completado - Usuario: ${tour.username} - Robot: ${tour.robot_id} liberados`);
                
                res.json({ 
                    success: true,
                    valido: true,
                    message: `Tour "${tour.tour_name}" completado exitosamente`,
                    tour_id: tour.tour_id,
                    tour_name: tour.tour_name,
                    user: tour.username,
                    robot_id: tour.robot_id,
                    completed_at: new Date().toISOString(),
                    feedback: {
                        type: 'tour_completed',
                        description: `Tour completado. Usuario y robot liberados.`
                    }
                });
            } else {
                res.status(500).json({ 
                    success: false,
                    error: 'No se pudo completar el tour' 
                });
            }
        });
        
    } catch (error) {
        console.error('Error al completar tour:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error interno del servidor' 
        });
    }
});

app.post('/api/robot/activate-tour', (req, res) => {
    const { tour_id, robot_name } = req.body;
    
    if (!tour_id) {
        return res.status(400).json({ error: 'ID de tour requerido' });
    }

    // Verificar que el tour existe y está activo
    db.get('SELECT * FROM tour_routes WHERE id = ? AND is_active = 1', [tour_id], (err, tour) => {
        if (err) {
            console.error('Error al verificar tour:', err);
            return res.status(500).json({ error: 'Error al verificar tour' });
        }
        
        if (!tour) {
            return res.status(404).json({ error: 'Tour no encontrado o no disponible' });
        }

        // Generar ID único para esta instancia del tour y PIN
        const tourInstanceId = Math.random().toString(36).substr(2, 9);
        const PIN = Array.from({ length: 5 }, () => Math.floor(Math.random() * 3)).join('');

        // Crear un usuario temporal para el robot o usar uno existente
        const robotUserId = -1; // ID especial para el robot
        
        // Guardar en historial de tours para el robot
        db.run(
            `INSERT INTO tour_history 
             (user_id, tour_route_id, tour_type, tour_name, tour_id, pin) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [robotUserId, tour_id, tour.name.toLowerCase().replace(/\s+/g, '-'), tour.name, tourInstanceId, PIN],
            function(err) {
                if (err) {
                    console.error('Error al guardar historial de tour para robot:', err);
                    return res.status(500).json({ error: 'Error al activar robot' });
                }
                
                // Enviar notificación de robot activado
                emailNotifier.sendNotification('ROBOT_ACTIVATED', {
                    tourName: tour.name,
                    robotName: robot_name || 'roberto',
                    routeName: tour.name
                });
                
                res.json({ 
                    success: true, 
                    message: `Robot activado para el tour "${tour.name}"`,
                    tourId: tourInstanceId,
                    tourName: tour.name,
                    tourDescription: tour.description,
                    duration: tour.duration,
                    PIN: PIN,
                    robotName: robot_name || 'roberto',
                    startTime: new Date().toISOString()
                });
            }
        );
    });
});

// API mejorada para verificar PIN del robot con prevención de conflictos
app.post('/api/robot/pin', (req, res) => {
    const { pin } = req.body;
    
    // Validar formato del PIN
    if (!pin || !Array.isArray(pin) || pin.length !== 5) {
        return res.status(400).json({ 
            success: false,
            valido: false,
            error: 'PIN debe ser un array de 5 dígitos',
            received: pin 
        });
    }
    
    // Validar que todos los elementos sean dígitos (0-9)
    const isValidPin = pin.every(digit => 
        typeof digit === 'number' && 
        Number.isInteger(digit) && 
        digit >= 0 && 
        digit <= 9
    );
    
    if (!isValidPin) {
        return res.status(400).json({ 
            success: false,
            valido: false,
            error: 'Todos los elementos del PIN deben ser dígitos entre 0 y 9',
            received: pin 
        });
    }
    
    const pinString = pin.join('');
    console.log(`🔍 Robot escaneó PIN: ${pinString}`);
    
    // Buscar tour activo con este PIN
    db.get(`
        SELECT th.*, tr.name as tour_name, tr.description, tr.duration, u.username
        FROM tour_history th
        LEFT JOIN tour_routes tr ON th.tour_route_id = tr.id
        LEFT JOIN users u ON th.user_id = u.id
        WHERE th.pin = ? AND th.completed = 0
        ORDER BY th.started_at DESC
        LIMIT 1
    `, [pinString], (err, tour) => {
        if (err) {
            console.error('Error al verificar PIN:', err);
            return res.status(500).json({ 
                success: false,
                valido: false,
                error: 'Error en la base de datos' 
            });
        }
        
        if (!tour) {
            console.log(`❌ PIN ${pinString} no válido o sin tours activos`);
            return res.json({ 
                success: false,
                valido: false,
                message: 'PIN incorrecto o no hay tours activos con este PIN',
                pin_received: pin,
                pin_string: pinString,
                feedback: {
                    type: 'invalid_pin',
                    description: 'El PIN ingresado no corresponde a ningún tour activo'
                }
            });
        }

        console.log(`✅ PIN ${pinString} válido - Tour: ${tour.tour_name} - Usuario: ${tour.username} - Robot: ${tour.robot_id || 'Sin asignar'}`);

        // Si el tour tiene robot asignado, verificar conflictos
        if (tour.robot_id) {
            checkRobotAvailability(tour.robot_id, (err, robotStatus) => {
                if (err) {
                    console.error('Error al verificar robot:', err);
                    // Continuar sin verificación de robot
                    processValidPin();
                    return;
                }

                // Si hay otro tour activo en el robot (conflicto)
                if (!robotStatus.isAvailable && robotStatus.activeTour.tour_id !== tour.tour_id) {
                    const conflictTour = robotStatus.activeTour;
                    console.log(`⚠️ CONFLICTO: Robot "${tour.robot_id}" ocupado con "${conflictTour.tour_name}" de ${conflictTour.username}`);
                    
                    // Cancelar tour conflictivo automáticamente
                    cancelRobotActiveTour(tour.robot_id, `PIN ${pinString} escaneado`, (cancelErr, cancelled) => {
                        if (cancelErr) {
                            console.error('Error cancelando conflicto:', cancelErr);
                        } else {
                            console.log(`🔧 Conflicto resuelto: ${cancelled} tour(s) cancelado(s)`);
                            
                            // Notificar tour abandonado
                            emailNotifier.sendNotification('TOUR_ABANDONED', {
                                tourName: conflictTour.tour_name,
                                username: conflictTour.username,
                                progress: 'Cancelado por escaneo QR conflictivo'
                            });
                        }
                        
                        processValidPin();
                    });
                } else {
                    processValidPin();
                }
            });
        } else {
            processValidPin();
        }

        function processValidPin() {
            // Obtener waypoints del tour
            db.all(`
                SELECT * FROM tour_waypoints 
                WHERE tour_route_id = ? 
                ORDER BY sequence_order ASC
            `, [tour.tour_route_id], async (waypointsErr, waypoints) => {
                if (waypointsErr) {
                    console.error('Error obteniendo waypoints:', waypointsErr);
                    return res.status(500).json({ 
                        success: false,
                        valido: false,
                        error: 'Error al obtener información del tour' 
                    });
                }
                
                console.log(`🔄 Procesando ${waypoints.length} waypoints con Gemini AI...`);
                
                // Procesar waypoints con Gemini AI
                const waypointsConDescripciones = await Promise.all(
                    waypoints.map(async (wp) => {
                        const waypointName = wp.name || `Waypoint ${wp.sequence_order}`;
                        const waypointDescription = wp.description || '';
                        
                        const cacheKey = `${tour.tour_route_id}-${wp.id}-${waypointName}-${waypointDescription}`;
                        
                        let descripcionDetallada;
                        if (descripcionesCache.has(cacheKey)) {
                            descripcionDetallada = descripcionesCache.get(cacheKey);
                        } else {
                            descripcionDetallada = await generarDescripcionDetallada(
                                waypointName, 
                                waypointDescription, 
                                tour.tour_name,
                                tour.description || 'Un recorrido turístico interesante'
                            );
                            descripcionesCache.set(cacheKey, descripcionDetallada);
                        }
                        
                        return {
                            id: wp.id,
                            x: wp.x,
                            y: wp.y,
                            z: wp.z || 0,
                            sequence_order: wp.sequence_order,
                            waypoint_type: wp.waypoint_type || 'navigation',
                            name: waypointName,
                            description: waypointDescription,
                            description_detailed: descripcionDetallada,
                            context: waypointDescription || '',
                            context_detailed: descripcionDetallada,
                            full_info: `${waypointName}: ${waypointDescription}`,
                            full_info_detailed: `${waypointName}: ${descripcionDetallada}`,
                            speech_text: descripcionDetallada,
                            speech_text_arrival: `Llegamos a ${waypointName}. ${descripcionDetallada}`,
                            speech_text_navigation: `Ahora nos dirigimos hacia ${waypointName}.`
                        };
                    })
                );
                
                console.log(`✅ PIN ${pinString} procesado - ${waypointsConDescripciones.length} waypoints listos`);
                
                // Respuesta exitosa
                res.json({ 
                    success: true,
                    valido: true,
                    message: 'PIN válido - Tour encontrado',
                    pin_received: pin,
                    pin_string: pinString,
                    usuario: tour.username,
                    tour: {
                        id: tour.id,
                        tour_id: tour.tour_id,
                        route_id: tour.tour_route_id,
                        name: tour.tour_name,
                        description: tour.description,
                        duration: tour.duration,
                        started_at: tour.started_at,
                        type: tour.tour_type,
                        robot_id: tour.robot_id,
                        robot_status: tour.robot_status,
                        waypoints: waypointsConDescripciones,
                        waypoint_count: waypointsConDescripciones.length
                    },
                    feedback: {
                        type: 'valid_pin',
                        description: `PIN correcto. Tour "${tour.tour_name}" para ${tour.username}`,
                        action: 'tour_ready',
                        waypoints_loaded: waypointsConDescripciones.length,
                        conflict_resolved: tour.robot_id ? 'checked' : 'not_applicable'
                    }
                });
            });
        }
    });
});

// API para verificar disponibilidad de robot antes de iniciar tour
app.get('/api/robot/:robotName/availability', requireAuth, (req, res) => {
    const robotName = req.params.robotName;
    
    checkRobotAvailability(robotName, (err, robotStatus) => {
        if (err) {
            return res.status(400).json({ 
                error: err.error,
                robot: robotName,
                available: false
            });
        }
        
        res.json({
            robot: robotName,
            available: robotStatus.isAvailable,
            status: robotStatus.robot.status,
            activeTour: robotStatus.activeTour || null,
            message: robotStatus.isAvailable 
                ? `Robot "${robotName}" disponible`
                : `Robot "${robotName}" ocupado con tour "${robotStatus.activeTour.tour_name}" del usuario "${robotStatus.activeTour.username}"`
        });
    });
});

// API para enviar tour al robot (simula el PIN del robot pero desde la web)
app.post('/api/robot/send-tour', requireAuth, (req, res) => {
    const { tour_history_id } = req.body;
    const userId = req.session.userId;
    
    if (!tour_history_id) {
        return res.status(400).json({ 
            success: false,
            error: 'ID del tour requerido' 
        });
    }
    
    // Buscar el tour del usuario que quiere enviar al robot
    db.get(`
        SELECT th.*, tr.name as tour_name, tr.description, tr.duration, tr.languages, tr.icon, tr.price, u.username
        FROM tour_history th
        LEFT JOIN tour_routes tr ON th.tour_route_id = tr.id
        LEFT JOIN users u ON th.user_id = u.id
        WHERE th.id = ? AND th.user_id = ? AND th.completed = 0
        LIMIT 1
    `, [tour_history_id, userId], (err, tour) => {
        if (err) {
            console.error('Error al buscar tour:', err);
            return res.status(500).json({ 
                success: false,
                error: 'Error en la base de datos' 
            });
        }
        
        if (!tour) {
            return res.status(404).json({ 
                success: false,
                error: 'Tour no encontrado o no pertenece al usuario' 
            });
        }
        
        // Obtener waypoints del tour
        const waypointsQuery = `
            SELECT * FROM tour_waypoints 
            WHERE tour_route_id = ? 
            ORDER BY sequence_order ASC
        `;
        
        db.all(waypointsQuery, [tour.tour_route_id], async (waypointsErr, waypoints) => {
            if (waypointsErr) {
                console.error('Error al obtener waypoints:', waypointsErr);
                return res.status(500).json({ 
                    success: false,
                    error: 'Error al obtener información del tour' 
                });
            }
            
            console.log(`🔄 Enviando tour "${tour.tour_name}" al robot - Procesando ${waypoints.length} waypoints con Gemini AI...`);
            
            // Procesar waypoints con Gemini AI exactamente igual que en /api/robot/pin
            const waypointsConDescripciones = await Promise.all(
                waypoints.map(async (wp) => {
                    const waypointName = wp.name || `Waypoint ${wp.sequence_order}`;
                    const waypointDescription = wp.description || '';
                    
                    // Crear clave de cache
                    const cacheKey = `${tour.tour_route_id}-${wp.id}-${waypointName}-${waypointDescription}`;
                    
                    let descripcionDetallada;
                    if (descripcionesCache.has(cacheKey)) {
                        descripcionDetallada = descripcionesCache.get(cacheKey);
                        console.log(`📋 Usando descripción cacheada para "${waypointName}"`);
                    } else {
                        // Generar descripción con Gemini AI
                        descripcionDetallada = await generarDescripcionDetallada(
                            waypointName, 
                            waypointDescription, 
                            tour.tour_name || tour.tour_name,
                            tour.description || 'Un interesante recorrido turístico'
                        );
                        
                        // Guardar en cache
                        descripcionesCache.set(cacheKey, descripcionDetallada);
                    }
                    
                    // Formato exactamente igual al de /api/robot/pin
                    return {
                        id: wp.id,
                        x: wp.x,
                        y: wp.y,
                        z: wp.z || 0,
                        sequence_order: wp.sequence_order,
                        waypoint_type: wp.waypoint_type || 'navigation',
                        name: waypointName,
                        description: waypointDescription,
                        description_detailed: descripcionDetallada,
                        context: waypointDescription || '',
                        context_detailed: descripcionDetallada,
                        full_info: `${waypointName}: ${waypointDescription}`,
                        full_info_detailed: `${waypointName}: ${descripcionDetallada}`,
                        speech_text: descripcionDetallada,
                        speech_text_arrival: `Llegamos a ${waypointName}. ${descripcionDetallada}`,
                        speech_text_navigation: `Ahora nos dirigimos hacia ${waypointName}.`
                    };
                })
            );
            
            console.log(`✅ Tour enviado al robot - Waypoints procesados con Gemini AI`);
            
            // Marcar el tour como asignado al robot (actualizar robot_status)
            db.run(`
                UPDATE tour_history 
                SET robot_status = 'in_progress'
                WHERE id = ?
            `, [tour.id], function(updateErr) {
                if (updateErr) {
                    console.error('Error al actualizar estado del tour:', updateErr);
                }
            });
            
            // Intentar enviar la información del tour directamente al robot mediante HTTP
            const tourData = {
                success: true,
                valido: true,
                message: 'Tour enviado desde la web',
                pin_received: tour.pin.split('').map(Number),
                pin_string: tour.pin,
                usuario: tour.username,
                tour: {
                    id: tour.id,
                    tour_id: tour.tour_id,
                    route_id: tour.tour_route_id,
                    name: tour.tour_name || tour.tour_name,
                    description: tour.description,
                    duration: tour.duration,
                    languages: tour.languages,
                    icon: tour.icon,
                    price: tour.price,
                    started_at: tour.started_at,
                    type: tour.tour_type,
                    waypoints: waypointsConDescripciones,
                    waypoint_count: waypointsConDescripciones.length
                },
                feedback: {
                    type: 'web_tour_assignment',
                    description: `Tour "${tour.tour_name}" enviado desde la web para usuario ${tour.username}`,
                    action: 'tour_ready',
                    waypoints_loaded: waypointsConDescripciones.length,
                    waypoints_info: waypointsConDescripciones.map(wp => ({
                        order: wp.sequence_order,
                        name: wp.name,
                        has_description: !!(wp.description && wp.description.length > 0),
                        has_detailed_description: !!(wp.description_detailed && wp.description_detailed.length > 0),
                        gemini_enhanced: true
                    })),
                    robot_info: {
                        robot_id: tour.robot_id || 'roberto',
                        robot_name: tour.robot_id || 'roberto',
                        status: 'tour_received',
                        timestamp: new Date().toISOString()
                    }
                }
            };
            
            // El robot solo tiene WebSocket ROS Bridge en ws://turtlebot-NUC.local:9090
            // NO tiene servidor HTTP, así que debe consultar este endpoint:
            console.log(`📋 Tour listo para el robot en 192.168.1.120`);
            console.log(`🤖 El robot debe consultar: GET /api/robot/pending-tours/${tour.robot_id || 'roberto'}`);
            console.log(`📡 Recibirá exactamente los mismos datos que con PIN válido`);
            
            // Enviar notificación de tour enviado al robot
            emailNotifier.sendNotification('ROBOT_TOUR_STARTED', {
                tourName: tour.tour_name,
                username: tour.username,
                robotId: tour.robot_id || 'roberto',
                routeName: tour.tour_name
            });
            
            // Respuesta exactamente igual a /api/robot/pin para compatibilidad total
            res.json({ 
                success: true,
                valido: true,  // Campo para compatibilidad con Python
                message: 'Tour enviado al robot correctamente',
                pin_received: tour.pin.split('').map(Number), // Convertir PIN string a array
                pin_string: tour.pin,
                usuario: tour.username,  // Información del usuario que inició el tour
                tour: {
                    id: tour.id,
                    tour_id: tour.tour_id,
                    route_id: tour.tour_route_id,
                    name: tour.tour_name || tour.tour_name,
                    description: tour.description,
                    duration: tour.duration,
                    languages: tour.languages,
                    icon: tour.icon,
                    price: tour.price,
                    started_at: tour.started_at,
                    type: tour.tour_type,
                    waypoints: waypointsConDescripciones,
                    waypoint_count: waypointsConDescripciones.length
                },
                feedback: {
                    type: 'tour_sent_to_robot',
                    description: `Tour "${tour.tour_name}" enviado al robot para usuario ${tour.username}`,
                    action: 'tour_ready',
                    waypoints_loaded: waypointsConDescripciones.length,
                    waypoints_info: waypointsConDescripciones.map(wp => ({
                        order: wp.sequence_order,
                        name: wp.name,
                        has_description: !!(wp.description && wp.description.length > 0),
                        has_detailed_description: !!(wp.description_detailed && wp.description_detailed.length > 0),
                        gemini_enhanced: true
                    })),
                    robot_info: {
                        robot_id: 'roberto',
                        status: 'tour_received',
                        timestamp: new Date().toISOString()
                    }
                }
            });
        });
    });
});

// API para que el robot consulte si tiene tours pendientes (sin autenticación - para uso del robot)
app.get('/api/robot/pending-tours/:robotId?', (req, res) => {
    const robotId = req.params.robotId || 'roberto';
    
    // Buscar tours activos asignados a este robot
    db.get(`
        SELECT th.*, tr.name as tour_name, tr.description, tr.duration, tr.languages, tr.icon, tr.price, u.username
        FROM tour_history th
        LEFT JOIN tour_routes tr ON th.tour_route_id = tr.id
        LEFT JOIN users u ON th.user_id = u.id
        WHERE th.robot_id = ? AND th.completed = 0 AND th.robot_status = 'in_progress'
        ORDER BY th.started_at DESC
        LIMIT 1
    `, [robotId], (err, tour) => {
        if (err) {
            console.error('Error al buscar tours pendientes:', err);
            return res.status(500).json({ 
                success: false,
                error: 'Error en la base de datos' 
            });
        }
        
        if (!tour) {
            return res.json({ 
                success: true,
                has_pending_tour: false,
                message: `No hay tours pendientes para el robot ${robotId}`,
                robot_id: robotId,
                valido: false  // Para compatibilidad con código del robot
            });
        }
        
        console.log(`✅ Tour pendiente encontrado para robot ${robotId}: "${tour.tour_name}" (Usuario: ${tour.username})`);
        
        // Hay un tour pendiente - obtener waypoints
        const waypointsQuery = `
            SELECT * FROM tour_waypoints 
            WHERE tour_route_id = ? 
            ORDER BY sequence_order ASC
        `;
        
        db.all(waypointsQuery, [tour.tour_route_id], async (waypointsErr, waypoints) => {
            if (waypointsErr) {
                console.error('Error al obtener waypoints:', waypointsErr);
                return res.status(500).json({ 
                    success: false,
                    error: 'Error al obtener información del tour' 
                });
            }
            
            console.log(`🔄 Robot ${robotId} consultó tour pendiente "${tour.tour_name}" - Procesando ${waypoints.length} waypoints con Gemini AI...`);
            
            // Procesar waypoints con Gemini AI exactamente igual que en otros endpoints
            const waypointsConDescripciones = await Promise.all(
                waypoints.map(async (wp) => {
                    const waypointName = wp.name || `Waypoint ${wp.sequence_order}`;
                    const waypointDescription = wp.description || '';
                    
                    // Crear clave de cache
                    const cacheKey = `${tour.tour_route_id}-${wp.id}-${waypointName}-${waypointDescription}`;
                    
                    let descripcionDetallada;
                    if (descripcionesCache.has(cacheKey)) {
                        descripcionDetallada = descripcionesCache.get(cacheKey);
                        console.log(`📋 Usando descripción cacheada para "${waypointName}"`);
                    } else {
                        // Generar descripción con Gemini AI
                        descripcionDetallada = await generarDescripcionDetallada(
                            waypointName, 
                            waypointDescription, 
                            tour.tour_name || tour.tour_name,
                            tour.description || 'Un interesante recorrido turístico'
                        );
                        
                        // Guardar en cache
                        descripcionesCache.set(cacheKey, descripcionDetallada);
                    }
                    
                    return {
                        id: wp.id,
                        x: wp.x,
                        y: wp.y,
                        z: wp.z || 0,
                        sequence_order: wp.sequence_order,
                        waypoint_type: wp.waypoint_type || 'navigation',
                        name: waypointName,
                        description: waypointDescription,
                        description_detailed: descripcionDetallada,
                        context: waypointDescription || '',
                        context_detailed: descripcionDetallada,
                        full_info: `${waypointName}: ${waypointDescription}`,
                        full_info_detailed: `${waypointName}: ${descripcionDetallada}`,
                        speech_text: descripcionDetallada,
                        speech_text_arrival: `Llegamos a ${waypointName}. ${descripcionDetallada}`,
                        speech_text_navigation: `Ahora nos dirigimos hacia ${waypointName}.`
                    };
                })
            );
            
            console.log(`✅ Robot ${robotId} recibió información del tour pendiente`);
            
            // Respuesta exactamente igual a /api/robot/pin para compatibilidad total
            res.json({ 
                success: true,
                has_pending_tour: true,
                valido: true,  // Campo para compatibilidad con Python
                message: 'Tour pendiente encontrado - Asignado desde la web',
                pin_received: tour.pin.split('').map(Number),
                pin_string: tour.pin,
                usuario: tour.username,
                robot_id: robotId,
                assignment_source: 'web',  // Indicar que viene desde la web
                tour: {
                    id: tour.id,
                    tour_id: tour.tour_id,
                    route_id: tour.tour_route_id,
                    name: tour.tour_name || tour.tour_name,
                    description: tour.description,
                    duration: tour.duration,
                    languages: tour.languages,
                    icon: tour.icon,
                    price: tour.price,
                    started_at: tour.started_at,
                    type: tour.tour_type,
                    waypoints: waypointsConDescripciones,
                    waypoint_count: waypointsConDescripciones.length
                },
                feedback: {
                    type: 'pending_tour_retrieved',
                    description: `Tour pendiente "${tour.tour_name}" recuperado para robot ${robotId} - Asignado desde web`,
                    action: 'tour_ready',
                    waypoints_loaded: waypointsConDescripciones.length,
                    waypoints_info: waypointsConDescripciones.map(wp => ({
                        order: wp.sequence_order,
                        name: wp.name,
                        has_description: !!(wp.description && wp.description.length > 0),
                        has_detailed_description: !!(wp.description_detailed && wp.description_detailed.length > 0),
                        gemini_enhanced: true
                    }))
                }
            });
        });
    });
});

// API específica para recibir confirmación del robot cuando recibe datos de tour
app.post('/api/robot/tour-data-received', (req, res) => {
    const { robot_id, tour_id, status, waypoints_count, timestamp, message } = req.body;
    
    console.log(`🤖 Robot ${robot_id || 'desconocido'} confirmó recepción de datos del tour:`);
    console.log(`   Tour ID: ${tour_id || 'N/A'}`);
    console.log(`   Estado: ${status || 'recibido'}`);
    console.log(`   Waypoints: ${waypoints_count || 'N/A'}`);
    console.log(`   Mensaje: ${message || 'Sin mensaje'}`);
    console.log(`   Timestamp: ${timestamp || new Date().toISOString()}`);
    
    // Actualizar el estado del tour en la base de datos si se proporciona tour_id
    if (tour_id && robot_id) {
        db.run(`
            UPDATE tour_history 
            SET robot_status = ?, robot_id = ?
            WHERE tour_id = ?
        `, [status || 'data_received', robot_id, tour_id], function(err) {
            if (err) {
                console.error('Error al actualizar estado del tour:', err);
            } else if (this.changes > 0) {
                console.log(`✅ Estado del tour ${tour_id} actualizado a: ${status || 'data_received'}`);
            }
        });
    }
    
    res.json({ 
        success: true,
        message: 'Confirmación de recepción registrada',
        robot_id: robot_id || 'desconocido',
        tour_id: tour_id || null,
        received_at: new Date().toISOString()
    });
});

// API para que el robot confirme recepción del tour (sin autenticación - para uso del robot)
app.post('/api/robot/confirm-tour-received', (req, res) => {
    const { robot_id, tour_id, status, message } = req.body;
    
    if (!robot_id || !tour_id) {
        return res.status(400).json({ 
            success: false,
            error: 'robot_id y tour_id son requeridos' 
        });
    }
    
    console.log(`🤖 Robot ${robot_id} confirmó recepción del tour ${tour_id}: ${status || 'received'} - ${message || 'Sin mensaje'}`);
    
    // Actualizar el estado del tour en la base de datos
    db.run(`
        UPDATE tour_history 
        SET robot_status = ?
        WHERE tour_id = ? AND robot_id = ?
    `, [status || 'confirmed', tour_id, robot_id], function(err) {
        if (err) {
            console.error('Error al actualizar estado del tour:', err);
            return res.status(500).json({ 
                success: false,
                error: 'Error al actualizar estado del tour' 
            });
        }
        
        if (this.changes === 0) {
            console.log(`⚠️  No se encontró el tour ${tour_id} para el robot ${robot_id}`);
        }
        
        res.json({ 
            success: true,
            message: 'Confirmación de recepción registrada',
            robot_id: robot_id,
            tour_id: tour_id,
            status: status || 'confirmed',
            timestamp: new Date().toISOString()
        });
    });
});

// Función auxiliar para verificar si un robot está disponible
function checkRobotAvailability(robotName, callback) {
    // Verificar si el robot existe y está activo
    db.get('SELECT * FROM robots WHERE name = ? AND status = ?', [robotName, 'active'], (err, robot) => {
        if (err) {
            return callback({ error: 'Error al verificar robot', details: err.message });
        }
        
        if (!robot) {
            return callback({ error: 'Robot no encontrado o no disponible' });
        }
        
        // Verificar si el robot tiene tours activos
        db.get(`
            SELECT th.*, u.username, tr.name as tour_name
            FROM tour_history th
            LEFT JOIN users u ON th.user_id = u.id
            LEFT JOIN tour_routes tr ON th.tour_route_id = tr.id
            WHERE th.robot_id = ? AND th.completed = 0
            ORDER BY th.started_at DESC
            LIMIT 1
        `, [robotName], (err, activeTour) => {
            if (err) {
                return callback({ error: 'Error al verificar tours activos', details: err.message });
            }
            
            callback(null, {
                robot: robot,
                isAvailable: !activeTour,
                activeTour: activeTour
            });
        });
    });
}

// Función auxiliar para cancelar tour activo de un robot
function cancelRobotActiveTour(robotName, reason = 'Tour cancelado automáticamente', callback) {
    db.run(`
        UPDATE tour_history 
        SET completed = 1, robot_status = 'cancelled'
        WHERE robot_id = ? AND completed = 0
    `, [robotName], function(err) {
        if (err) {
            return callback(err);
        }
        
        console.log(`🔄 Tours activos cancelados para robot ${robotName}: ${this.changes} tour(s). Razón: ${reason}`);
        callback(null, this.changes);
    });
}

// Función auxiliar para completar tour (reutilizable)
function completeTour(req, res) {
    const { tour_id } = req.body;
    
    // Validar que se proporcione el tour_id
    if (!tour_id) {
        console.log('❌ Error: tour_id no proporcionado');
        return res.status(400).json({ 
            success: false,
            error: 'tour_id es requerido',
            received: req.body 
        });
    }
    
    // Buscar el tour activo con este tour_id
    db.get(`
        SELECT th.*, tr.name as tour_name, tr.languages, tr.icon, tr.price, u.username
        FROM tour_history th
        LEFT JOIN tour_routes tr ON th.tour_route_id = tr.id
        LEFT JOIN users u ON th.user_id = u.id
        WHERE th.tour_id = ? AND th.completed = 0
        LIMIT 1
    `, [tour_id], (err, tour) => {
        if (err) {
            console.error('❌ Error al buscar tour:', err);
            return res.status(500).json({ 
                success: false,
                error: 'Error en la base de datos' 
            });
        }
        
        if (!tour) {
            console.log(`❌ Tour no encontrado o ya completado: ${tour_id}`);
            return res.status(404).json({ 
                success: false,
                error: 'Tour no encontrado o ya completado',
                tour_id: tour_id,
                message: 'No se encontró un tour activo con este ID'
            });
        }
        
        // Marcar el tour como completado
        db.run(`
            UPDATE tour_history 
            SET completed = 1 
            WHERE tour_id = ? AND completed = 0
        `, [tour_id], function(err) {
            if (err) {
                console.error('❌ Error al completar tour:', err);
                return res.status(500).json({ 
                    success: false,
                    error: 'Error al actualizar el tour' 
                });
            }
            
            if (this.changes === 0) {
                console.log(`⚠️ No se actualizó ningún registro para tour: ${tour_id}`);
                return res.status(404).json({ 
                    success: false,
                    error: 'No se pudo completar el tour',
                    tour_id: tour_id,
                    message: 'El tour no fue encontrado o ya estaba completado'
                });
            }
            
            console.log(`✅ Tour completado por robot: ${tour.tour_name} (ID: ${tour_id}) para usuario ${tour.username}`);
            
            // Calcular duración del tour
            const startTime = new Date(tour.started_at);
            const endTime = new Date();
            const durationMs = endTime - startTime;
            const durationMin = Math.round(durationMs / (1000 * 60));
            
            // Enviar notificación de tour completado
            emailNotifier.sendNotification('TOUR_COMPLETED', {
                tourName: tour.tour_name,
                username: tour.username,
                duration: durationMin,
                rating: tour.rating || 'N/A'
            });
            
            // Respuesta exitosa
            res.json({ 
                success: true,
                message: 'Tour marcado como completado exitosamente',
                tour_id: tour_id,
                tour: {
                    id: tour.id,
                    name: tour.tour_name,
                    username: tour.username,
                    started_at: tour.started_at,
                    completed_at: new Date().toISOString()
                },
                feedback: {
                    type: 'tour_completed',
                    description: `Tour "${tour.tour_name}" completado exitosamente para usuario ${tour.username}`,
                    action: 'tour_finished'
                }
            });
        });
    });
}

// API para marcar tour como completado (sin autenticación - para uso del robot)
app.post('/api/robot/tour/complete', completeTour);

// Alias para compatibilidad con versiones anteriores del robot
app.post('/tour/complete', completeTour);

// WebSocket para monitoreo en tiempo real del estado de tours y robots
app.ws('/ws/tour-status', (ws, req) => {
    console.log('Cliente conectado al WebSocket de estado de tours');
    
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            
            if (data.type === 'subscribe_robot_status') {
                // Suscribir al estado de un robot específico
                const robotId = data.robotId;
                
                // Aquí se podría implementar lógica de suscripción
                ws.send(JSON.stringify({
                    type: 'subscription_confirmed',
                    robotId: robotId
                }));
            }
            
            if (data.type === 'get_robot_status') {
                const robotId = data.robotId;
                
                checkRobotActiveStatus(robotId)
                    .then(activeTour => {
                        ws.send(JSON.stringify({
                            type: 'robot_status',
                            robotId: robotId,
                            isOccupied: !!activeTour,
                            activeTour: activeTour,
                            timestamp: new Date().toISOString()
                        }));
                    })
                    .catch(error => {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Error al obtener estado del robot',
                            error: error.message
                        }));
                    });
            }
            
        } catch (error) {
            console.error('Error procesando mensaje WebSocket:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Cliente desconectado del WebSocket de estado de tours');
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Acceso web: http://localhost:${PORT}`);
});

// API para obtener información detallada de un waypoint específico (para uso del robot)
app.get('/api/robot/waypoint/:id', (req, res) => {
    const waypointId = req.params.id;
    
    const query = `
        SELECT tw.*, tr.name as tour_name, tr.description as tour_description
        FROM tour_waypoints tw
        LEFT JOIN tour_routes tr ON tw.tour_route_id = tr.id
        WHERE tw.id = ?
    `;
    
    db.get(query, [waypointId], (err, waypoint) => {
        if (err) {
            console.error('Error al obtener waypoint:', err);
            return res.status(500).json({ 
                success: false,
                error: 'Error en la base de datos' 
            });
        }
        
        if (!waypoint) {
            return res.status(404).json({ 
                success: false,
                error: 'Waypoint no encontrado',
                waypoint_id: waypointId
            });
        }
        
        res.json({
            success: true,
            waypoint: {
                id: waypoint.id,
                tour_route_id: waypoint.tour_route_id,
                tour_name: waypoint.tour_name,
                tour_description: waypoint.tour_description,
                x: waypoint.x,
                y: waypoint.y,
                z: waypoint.z || 0,
                sequence_order: waypoint.sequence_order,
                waypoint_type: waypoint.waypoint_type || 'navigation',
                name: waypoint.name || `Waypoint ${waypoint.sequence_order}`,
                description: waypoint.description || '',
                context: waypoint.description || '',
                full_info: `${waypoint.name || `Waypoint ${waypoint.sequence_order}`}: ${waypoint.description || 'Sin descripción'}`,
                speech_text: `Llegamos a ${waypoint.name || `Waypoint ${waypoint.sequence_order}`}. ${waypoint.description || 'Sin información adicional.'}`
            },
            message: `Información del waypoint "${waypoint.name || `Waypoint ${waypoint.sequence_order}`}" obtenida exitosamente`
        });
        
        // Log del acceso del robot
        console.log(`🤖 Robot accedió a waypoint: ${waypoint.name || `Waypoint ${waypoint.sequence_order}`} (ID: ${waypoint.id}) - Tour: ${waypoint.tour_name}`);
    });
});

// API para obtener el siguiente waypoint en la secuencia (para uso del robot)
app.get('/api/robot/tour/:tourId/waypoint/next/:currentSequence', (req, res) => {
    const { tourId, currentSequence } = req.params;
    const nextSequence = parseInt(currentSequence) + 1;
    
    // Primero obtener el tour_route_id desde el tour_id
    db.get(`
        SELECT tour_route_id 
        FROM tour_history 
        WHERE tour_id = ?
    `, [tourId], (err, tour) => {
        if (err) {
            console.error('Error al obtener tour:', err);
            return res.status(500).json({ 
                success: false,
                error: 'Error en la base de datos' 
            });
        }
        
        if (!tour) {
            return res.status(404).json({ 
                success: false,
                error: 'Tour no encontrado',
                tour_id: tourId
            });
        }
        
        // Obtener el siguiente waypoint
        db.get(`
            SELECT * FROM tour_waypoints 
            WHERE tour_route_id = ? AND sequence_order = ?
        `, [tour.tour_route_id, nextSequence], (err, waypoint) => {
            if (err) {
                console.error('Error al obtener siguiente waypoint:', err);
                return res.status(500).json({ 
                    success: false,
                    error: 'Error en la base de datos' 
                });
            }
            
            if (!waypoint) {
                return res.json({ 
                    success: true,
                    waypoint: null,
                    message: 'No hay más waypoints en el tour',
                    tour_completed: true
                });
            }
            
            res.json({
                success: true,
                waypoint: {
                    id: waypoint.id,
                    x: waypoint.x,
                    y: waypoint.y,
                    z: waypoint.z || 0,
                    sequence_order: waypoint.sequence_order,
                    waypoint_type: waypoint.waypoint_type || 'navigation',
                    name: waypoint.name || `Waypoint ${waypoint.sequence_order}`,
                    description: waypoint.description || '',
                    context: waypoint.description || '',
                    full_info: `${waypoint.name || `Waypoint ${waypoint.sequence_order}`}: ${waypoint.description || 'Sin descripción'}`,
                    speech_text: `Siguiente destino: ${waypoint.name || `Waypoint ${waypoint.sequence_order}`}. ${waypoint.description || ''}`
                },
                message: `Siguiente waypoint "${waypoint.name || `Waypoint ${waypoint.sequence_order}`}" obtenido exitosamente`,
                tour_completed: false
            });
        });
    });
});

// API para que el robot reporte llegada a un waypoint específico
app.post('/api/robot/waypoint/arrived', (req, res) => {
    const { tour_id, waypoint_id, sequence_order, timestamp } = req.body;
    
    if (!tour_id || (!waypoint_id && !sequence_order)) {
        return res.status(400).json({ 
            success: false,
            error: 'tour_id y (waypoint_id o sequence_order) son requeridos' 
        });
    }
    
    // Obtener información del waypoint
    let waypointQuery = '';
    let waypointParams = [];
    
    if (waypoint_id) {
        waypointQuery = `
            SELECT tw.*, th.user_id, u.username, tr.name as tour_name
            FROM tour_waypoints tw
            JOIN tour_history th ON tw.tour_route_id = th.tour_route_id
            JOIN users u ON th.user_id = u.id
            JOIN tour_routes tr ON tw.tour_route_id = tr.id
            WHERE tw.id = ? AND th.tour_id = ?
        `;
        waypointParams = [waypoint_id, tour_id];
    } else {
        waypointQuery = `
            SELECT tw.*, th.user_id, u.username, tr.name as tour_name
            FROM tour_waypoints tw
            JOIN tour_history th ON tw.tour_route_id = th.tour_route_id
            JOIN users u ON th.user_id = u.id
            JOIN tour_routes tr ON tw.tour_route_id = tr.id
            WHERE tw.sequence_order = ? AND th.tour_id = ?
        `;
        waypointParams = [sequence_order, tour_id];
    }
    
    db.get(waypointQuery, waypointParams, (err, waypoint) => {
        if (err) {
            console.error('Error al obtener waypoint arrival:', err);
            return res.status(500).json({ 
                success: false,
                error: 'Error en la base de datos' 
            });
        }
        
        if (!waypoint) {
            return res.status(404).json({ 
                success: false,
                error: 'Waypoint o tour no encontrado' 
            });
        }
        
        // Log del evento
        const waypointName = waypoint.name || `Waypoint ${waypoint.sequence_order}`;
        const logMessage = `🤖 Robot llegó a "${waypointName}" - Tour: ${waypoint.tour_name} - Usuario: ${waypoint.username}`;
        console.log(logMessage);
        
        // Respuesta exitosa con información del waypoint
        res.json({
            success: true,
            message: 'Llegada a waypoint registrada exitosamente',
            waypoint: {
                id: waypoint.id,
                name: waypointName,
                description: waypoint.description || '',
                sequence_order: waypoint.sequence_order,
                coordinates: {
                    x: waypoint.x,
                    y: waypoint.y,
                    z: waypoint.z || 0
                }
            },
            tour: {
                tour_id: tour_id,
                tour_name: waypoint.tour_name,
                username: waypoint.username
            },
            timestamp: timestamp || new Date().toISOString(),
            next_action: waypoint.sequence_order === 1 ? 
                'start_tour_speech' : 
                'continue_tour'
        });
    });
});

// API para logout
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cerrar sesión' });
        }
        // Limpiar la cookie de sesión
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Sesión cerrada' });
    });
});

// ===== API ENDPOINTS PARA GESTIÓN DE TOURS =====

// API para obtener todos los tours (público - para index.html)
app.get('/api/tours', (req, res) => {
    const query = `
        SELECT tr.id, tr.name, tr.description, tr.duration, tr.languages, tr.icon, tr.price, tr.is_active as status, tr.created_at,
               ROUND(AVG(th.rating), 1) as average_rating,
               COUNT(th.rating) as total_ratings,
               COUNT(DISTINCT tw.id) as waypoint_count
        FROM tour_routes tr
        LEFT JOIN tour_history th ON tr.id = th.tour_route_id AND th.rating IS NOT NULL
        LEFT JOIN tour_waypoints tw ON tr.id = tw.tour_route_id
        WHERE tr.is_active = 1 
        GROUP BY tr.id, tr.name, tr.description, tr.duration, tr.languages, tr.icon, tr.price, tr.is_active, tr.created_at
        ORDER BY tr.created_at DESC
    `;
    
    db.all(query, [], (err, tours) => {
        if (err) {
            console.error('Error al obtener tours:', err);
            return res.status(500).json({ error: 'Error al obtener tours' });
        }
        
        const formattedTours = tours.map(tour => ({
            ...tour,
            status: tour.status ? 'active' : 'inactive'
        }));
        
        res.json(formattedTours);
    });
});

// API para obtener waypoints de un tour específico (para ejecución del robot)
app.get('/api/tours/:id/waypoints', async (req, res) => {
    const tourId = req.params.id;
    
    const query = `
        SELECT tw.*, tr.name as tour_name, tr.description as tour_description
        FROM tour_waypoints tw
        LEFT JOIN tour_routes tr ON tw.tour_route_id = tr.id
        WHERE tw.tour_route_id = ? 
        ORDER BY tw.sequence_order ASC
    `;
    
    db.all(query, [tourId], async (err, waypoints) => {
        if (err) {
            console.error('Error al obtener waypoints:', err);
            return res.status(500).json({ error: 'Error al obtener waypoints' });
        }
        
        if (waypoints.length === 0) {
            return res.json([]);
        }
        
        const tourName = waypoints[0].tour_name || 'Tour';
        const tourDescription = waypoints[0].tour_description || 'Un recorrido interesante';
        
        console.log(`🔄 Procesando ${waypoints.length} waypoints con Gemini AI para tour ${tourName}...`);
        
        // Formatear waypoints con información completa mejorada por Gemini
        const formattedWaypoints = await Promise.all(
            waypoints.map(async (wp) => {
                const waypointName = wp.name || `Waypoint ${wp.sequence_order}`;
                const waypointDescription = wp.description || '';
                
                // Crear clave de cache
                const cacheKey = `${tourId}-${wp.id}-${waypointName}-${waypointDescription}`;
                
                let descripcionDetallada;
                if (descripcionesCache.has(cacheKey)) {
                    descripcionDetallada = descripcionesCache.get(cacheKey);
                } else {
                    descripcionDetallada = await generarDescripcionDetallada(
                        waypointName, 
                        waypointDescription, 
                        tourName,
                        tourDescription
                    );
                    descripcionesCache.set(cacheKey, descripcionDetallada);
                }
                
                return {
                    id: wp.id,
                    x: wp.x,
                    y: wp.y,
                    z: wp.z || 0,
                    sequence_order: wp.sequence_order,
                    waypoint_type: wp.waypoint_type || 'navigation',
                    name: waypointName,
                    description: waypointDescription,
                    description_detailed: descripcionDetallada,
                    context: waypointDescription || '',
                    context_detailed: descripcionDetallada,
                    full_info: `${waypointName}: ${waypointDescription}`,
                    full_info_detailed: `${waypointName}: ${descripcionDetallada}`,
                    speech_text: descripcionDetallada,
                    speech_text_arrival: `Llegamos a ${waypointName}. ${descripcionDetallada}`,
                    speech_text_navigation: `Ahora nos dirigimos hacia ${waypointName}.`
                };
            })
        );
        
        console.log(`✅ Waypoints procesados con Gemini AI`);
        res.json(formattedWaypoints);
    });
});

// API para obtener todos los tours (admin)
app.get('/api/admin/tours', requireTechOrAdmin, (req, res) => {
    const query = `
        SELECT 
            tr.*,
            u.username as created_by_name,
            ratings.average_rating,
            ratings.total_ratings,
            COALESCE(waypoint_counts.waypoint_count, 0) as waypoint_count,
            COALESCE(history_counts.history_count, 0) as history_count
        FROM tour_routes tr
        LEFT JOIN users u ON tr.created_by = u.id
        LEFT JOIN (
            SELECT tour_route_id, 
                   ROUND(AVG(rating), 1) as average_rating,
                   COUNT(rating) as total_ratings
            FROM tour_history 
            WHERE rating IS NOT NULL
            GROUP BY tour_route_id
        ) ratings ON tr.id = ratings.tour_route_id
        LEFT JOIN (
            SELECT tour_route_id, COUNT(*) as waypoint_count
            FROM tour_waypoints
            GROUP BY tour_route_id
        ) waypoint_counts ON tr.id = waypoint_counts.tour_route_id
        LEFT JOIN (
            SELECT tour_route_id, COUNT(*) as history_count
            FROM tour_history
            GROUP BY tour_route_id
        ) history_counts ON tr.id = history_counts.tour_route_id
        ORDER BY tr.created_at DESC
    `;
    
    db.all(query, [], (err, tours) => {
        if (err) {
            console.error('Error al obtener tours:', err);
            return res.status(500).json({ error: 'Error al obtener tours' });
        }
        
        const formattedTours = tours.map(tour => ({
            ...tour,
            status: tour.is_active ? 'active' : 'inactive',
            history_count: tour.history_count || 0
        }));
        
        res.json(formattedTours);
    });
});

// API para obtener un tour específico (admin)
app.get('/api/admin/tours/:id', requireTechOrAdmin, (req, res) => {
    const tourId = req.params.id;
    
    const query = `
        SELECT tr.*, u.username as created_by_name
        FROM tour_routes tr
        LEFT JOIN users u ON tr.created_by = u.id
        WHERE tr.id = ?
    `;
    
    db.get(query, [tourId], (err, tour) => {
        if (err) {
            console.error('Error al obtener tour:', err);
            return res.status(500).json({ error: 'Error al obtener tour' });
        }
        
        if (!tour) {
            return res.status(404).json({ error: 'Tour no encontrado' });
        }
        
        const formattedTour = {
            ...tour,
            status: tour.is_active ? 'active' : 'inactive'
        };
        
        res.json(formattedTour);
    });
});

// API para crear un nuevo tour (admin)
app.post('/api/admin/tours', requireTechOrAdmin, (req, res) => {
    const { name, description, duration, languages, icon, price, status } = req.body;
    const createdBy = req.session.userId;
    
    // Validaciones
    if (!name || !description || !duration) {
        return res.status(400).json({ error: 'Nombre, descripción y duración son obligatorios' });
    }
    
    if (duration < 1) {
        return res.status(400).json({ error: 'La duración debe ser al menos 1 minuto' });
    }
    
    const isActive = status === 'active' ? 1 : 0;
    const tourPrice = price || 0;
    
    const query = `
        INSERT INTO tour_routes (name, description, duration, languages, icon, price, is_active, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(query, [name, description, duration, languages, icon, tourPrice, isActive, createdBy], function(err) {
        if (err) {
            console.error('Error al crear tour:', err);
            return res.status(500).json({ error: 'Error al crear tour' });
        }
        
        res.status(201).json({
            success: true,
            message: 'Tour creado exitosamente',
            tourId: this.lastID
        });
    });
});

// API para actualizar un tour (admin)
app.put('/api/admin/tours/:id', requireTechOrAdmin, (req, res) => {
    const tourId = req.params.id;
    const { name, description, duration, languages, icon, price, status } = req.body;
    
    // Validaciones
    if (!name || !description || !duration) {
        return res.status(400).json({ error: 'Nombre, descripción y duración son obligatorios' });
    }
    
    if (duration < 1) {
        return res.status(400).json({ error: 'La duración debe ser al menos 1 minuto' });
    }
    
    const isActive = status === 'active' ? 1 : 0;
    const tourPrice = price || 0;
    
    const query = `
        UPDATE tour_routes 
        SET name = ?, description = ?, duration = ?, languages = ?, icon = ?, price = ?, is_active = ?
        WHERE id = ?
    `;
    
    db.run(query, [name, description, duration, languages, icon, tourPrice, isActive, tourId], function(err) {
        if (err) {
            console.error('Error al actualizar tour:', err);
            return res.status(500).json({ error: 'Error al actualizar tour' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Tour no encontrado' });
        }
        
        res.json({
            success: true,
            message: 'Tour actualizado exitosamente'
        });
    });
});

// API para eliminar un tour (admin)
app.delete('/api/admin/tours/:id', requireTechOrAdmin, (req, res) => {
    const tourId = req.params.id;
    
    // Verificar si hay historial de tours para mostrar información relevante
    db.get('SELECT COUNT(*) as count FROM tour_history WHERE tour_route_id = ?', [tourId], (err, result) => {
        if (err) {
            console.error('Error al verificar historial:', err);
            return res.status(500).json({ error: 'Error al verificar historial' });
        }
        
        const hasHistory = result && result.count > 0;
        
        // Eliminar waypoints asociados primero
        db.run('DELETE FROM tour_waypoints WHERE tour_route_id = ?', [tourId], function(waypointErr) {
            if (waypointErr) {
                console.error('Error al eliminar waypoints:', waypointErr);
                return res.status(500).json({ error: 'Error al eliminar waypoints del tour' });
            }
            
            // Eliminar la ruta completamente (el histórico se mantiene intacto)
            db.run('DELETE FROM tour_routes WHERE id = ?', [tourId], function(err) {
                if (err) {
                    console.error('Error al eliminar tour:', err);
                    return res.status(500).json({ error: 'Error al eliminar tour' });
                }
                
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Tour no encontrado' });
                }
                
                const message = hasHistory 
                    ? `Tour eliminado exitosamente. El historial de ${result.count} tour(s) realizado(s) se mantiene para estadísticas.`
                    : 'Tour eliminado exitosamente.';
                
                res.json({
                    success: true,
                    message: message,
                    historyPreserved: hasHistory,
                    historyCount: result.count
                });
            });
        });
    });
});

// ===== API ENDPOINTS PARA WAYPOINTS =====

// API para obtener waypoints de un tour
app.get('/api/admin/tours/:id/waypoints', requireTechOrAdmin, (req, res) => {
    const tourId = req.params.id;
    
    const query = `
        SELECT * FROM tour_waypoints 
        WHERE tour_route_id = ? 
        ORDER BY sequence_order ASC
    `;
    
    db.all(query, [tourId], (err, waypoints) => {
        if (err) {
            console.error('Error al obtener waypoints:', err);
            return res.status(500).json({ error: 'Error al obtener waypoints' });
        }
        
        // Formatear waypoints para el panel de administración
        const formattedWaypoints = waypoints.map(wp => ({
            id: wp.id,
            x: wp.x,
            y: wp.y,
            z: wp.z || 0,
            sequence_order: wp.sequence_order,
            waypoint_type: wp.waypoint_type || 'navigation',
            name: wp.name || `Waypoint ${wp.sequence_order}`,
            description: wp.description || '',
            // Para compatibilidad con el formato anterior
            description_legacy: wp.description && wp.name ? 
                `${wp.name}: ${wp.description}` : 
                wp.description || wp.name || ''
        }));
        
        res.json(formattedWaypoints);
    });
});

// API para guardar waypoints de un tour
app.post('/api/admin/tours/:id/waypoints', requireTechOrAdmin, (req, res) => {
    const tourId = req.params.id;
    const { waypoints } = req.body;
    
    if (!waypoints || !Array.isArray(waypoints)) {
        return res.status(400).json({ error: 'Waypoints debe ser un array' });
    }
    
    // Validar formato de waypoints
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (typeof wp.x !== 'number' || typeof wp.y !== 'number') {
            return res.status(400).json({ 
                error: `Waypoint ${i + 1}: coordenadas x,y deben ser números` 
            });
        }
    }
    
    // Verificar que el tour existe
    db.get('SELECT id FROM tour_routes WHERE id = ?', [tourId], (err, tour) => {
        if (err) {
            console.error('Error al verificar tour:', err);
            return res.status(500).json({ error: 'Error en la base de datos' });
        }
        
        if (!tour) {
            return res.status(404).json({ error: 'Tour no encontrado' });
        }
        
        // Transacción para eliminar waypoints existentes e insertar nuevos
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            // Eliminar waypoints existentes del tour
            db.run('DELETE FROM tour_waypoints WHERE tour_route_id = ?', [tourId], (err) => {
                if (err) {
                    console.error('Error al eliminar waypoints existentes:', err);
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Error al limpiar waypoints' });
                }
                
                // Insertar nuevos waypoints
                const insertStmt = db.prepare(`
                    INSERT INTO tour_waypoints (tour_route_id, x, y, z, sequence_order, waypoint_type, name, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);
                
                let insertCount = 0;
                let hasError = false;
                
                if (waypoints.length === 0) {
                    // Si no hay waypoints, solo hacer commit
                    insertStmt.finalize();
                    db.run('COMMIT');
                    return res.json({ 
                        success: true, 
                        message: 'Waypoints eliminados exitosamente',
                        count: 0 
                    });
                }
                
                waypoints.forEach((waypoint, index) => {
                    // Parsear nombre y descripción si vienen en el formato "Nombre: Descripción"
                    let waypointName = '';
                    let waypointDescription = '';
                    
                    if (waypoint.name) {
                        waypointName = waypoint.name;
                        waypointDescription = waypoint.description || '';
                    } else if (waypoint.description) {
                        // Si viene en formato "Nombre: Descripción"
                        const parts = waypoint.description.split(': ');
                        if (parts.length >= 2) {
                            waypointName = parts[0].trim();
                            waypointDescription = parts.slice(1).join(': ').trim();
                        } else {
                            waypointName = `Waypoint ${index + 1}`;
                            waypointDescription = waypoint.description;
                        }
                    } else {
                        waypointName = `Waypoint ${index + 1}`;
                        waypointDescription = '';
                    }
                    
                    insertStmt.run([
                        tourId,
                        waypoint.x,
                        waypoint.y,
                        waypoint.z || 0,
                        index + 1,
                        waypoint.type || 'navigation',
                        waypointName,
                        waypointDescription
                    ], function(err) {
                        if (err && !hasError) {
                            hasError = true;
                            console.error('Error al insertar waypoint:', err);
                            insertStmt.finalize();
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Error al guardar waypoints' });
                        }
                        
                        insertCount++;
                        if (insertCount === waypoints.length && !hasError) {
                            insertStmt.finalize();
                            db.run('COMMIT', (err) => {
                                if (err) {
                                    console.error('Error al hacer commit:', err);
                                    return res.status(500).json({ error: 'Error al finalizar operación' });
                                }
                                
                                res.json({ 
                                    success: true, 
                                    message: 'Waypoints guardados exitosamente',
                                    count: insertCount,
                                    waypoints: waypoints.map((wp, idx) => ({
                                        ...wp,
                                        name: wp.name || (wp.description && wp.description.includes(': ') ? 
                                            wp.description.split(': ')[0].trim() : 
                                            `Waypoint ${idx + 1}`),
                                        sequence_order: idx + 1
                                    }))
                                });
                            });
                        }
                    });
                });
            });
        });
    });
});

// API para eliminar todos los waypoints de un tour
app.delete('/api/admin/tours/:id/waypoints', requireTechOrAdmin, (req, res) => {
    const tourId = req.params.id;
    
    db.run('DELETE FROM tour_waypoints WHERE tour_route_id = ?', [tourId], function(err) {
        if (err) {
            console.error('Error al eliminar waypoints:', err);
            return res.status(500).json({ error: 'Error al eliminar waypoints' });
        }
        
        res.json({ 
            success: true, 
            message: 'Waypoints eliminados exitosamente',
            deleted_count: this.changes 
        });
    });
});

// API para obtener reseñas de un tour específico
app.get('/api/admin/tours/:id/reviews', requireTechOrAdmin, (req, res) => {
    const tourId = req.params.id;
    
    const query = `
        SELECT th.rating, th.feedback, th.started_at, u.username
        FROM tour_history th
        JOIN users u ON th.user_id = u.id
        WHERE th.tour_route_id = ? AND th.rating IS NOT NULL
        ORDER BY th.started_at DESC
    `;
    
    db.all(query, [tourId], (err, reviews) => {
        if (err) {
            console.error('Error al obtener reseñas:', err);
            return res.status(500).json({ error: 'Error al obtener reseñas' });
        }
        
        res.json(reviews);
    });
});

// ===== ROBOT MANAGEMENT APIs =====

// API para obtener todos los robots (para admin)
app.get('/api/admin/robots', requireTechOrAdmin, (req, res) => {
    const query = `
        SELECT r.*, 
               COUNT(th.id) as tours_completed
        FROM robots r
        LEFT JOIN tour_history th ON th.robot_id = r.name AND th.completed = 1
        GROUP BY r.id
        ORDER BY r.created_at DESC
    `;
    
    db.all(query, [], (err, robots) => {
        if (err) {
            console.error('Error al obtener robots:', err);
            return res.status(500).json({ error: 'Error al obtener robots' });
        }
        
        res.json(robots);
    });
});

// API para obtener lista simple de robots (para dropdown)
app.get('/api/robots', requireAuth, (req, res) => {
    const query = `SELECT id, name, status FROM robots WHERE status = 'active' ORDER BY name`;
    
    db.all(query, [], (err, robots) => {
        if (err) {
            console.error('Error al obtener robots activos:', err);
            return res.status(500).json({ error: 'Error al obtener robots' });
        }
        
        res.json(robots);
    });
});

// API para obtener un robot específico
app.get('/api/admin/robots/:id', requireTechOrAdmin, (req, res) => {
    const robotId = req.params.id;
    
    const query = `SELECT * FROM robots WHERE id = ?`;
    
    db.get(query, [robotId], (err, robot) => {
        if (err) {
            console.error('Error al obtener robot:', err);
            return res.status(500).json({ error: 'Error al obtener robot' });
        }
        
        if (!robot) {
            return res.status(404).json({ error: 'Robot no encontrado' });
        }
        
        res.json(robot);
    });
});

// API para crear un nuevo robot
app.post('/api/admin/robots', requireTechOrAdmin, (req, res) => {
    const { name, status = 'active' } = req.body;
    
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'El nombre del robot es obligatorio' });
    }
    
    const validStatuses = ['active', 'maintenance', 'offline'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Estado de robot inválido' });
    }
    
    const query = `
        INSERT INTO robots (name, status, created_at, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    
    db.run(query, [name.trim(), status], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ error: 'Ya existe un robot con ese nombre' });
            }
            console.error('Error al crear robot:', err);
            return res.status(500).json({ error: 'Error al crear robot' });
        }
        
        res.status(201).json({
            id: this.lastID,
            name: name.trim(),
            status,
            message: 'Robot creado exitosamente'
        });
    });
});

// API para actualizar un robot
app.put('/api/admin/robots/:id', requireTechOrAdmin, (req, res) => {
    const robotId = req.params.id;
    const { name, status } = req.body;
    
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'El nombre del robot es obligatorio' });
    }
    
    const validStatuses = ['active', 'maintenance', 'offline'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Estado de robot inválido' });
    }
    
    const query = `
        UPDATE robots 
        SET name = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `;
    
    db.run(query, [name.trim(), status, robotId], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ error: 'Ya existe un robot con ese nombre' });
            }
            console.error('Error al actualizar robot:', err);
            return res.status(500).json({ error: 'Error al actualizar robot' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Robot no encontrado' });
        }
        
        res.json({ message: 'Robot actualizado exitosamente' });
    });
});

// API para eliminar un robot
app.delete('/api/admin/robots/:id', requireTechOrAdmin, (req, res) => {
    const robotId = req.params.id;
    
    // Verificar si el robot tiene tours activos
    const checkActiveQuery = `
        SELECT COUNT(*) as active_count 
        FROM tour_history th
        JOIN robots r ON th.robot_id = r.name
        WHERE r.id = ? AND th.completed = 0
    `;
    
    db.get(checkActiveQuery, [robotId], (err, result) => {
        if (err) {
            console.error('Error al verificar tours activos:', err);
            return res.status(500).json({ error: 'Error al verificar tours activos' });
        }
        
        if (result.active_count > 0) {
            return res.status(409).json({ 
                error: 'No se puede eliminar el robot porque tiene tours activos' 
            });
        }
        
        // Eliminar el robot
        const deleteQuery = `DELETE FROM robots WHERE id = ?`;
        
        db.run(deleteQuery, [robotId], function(err) {
            if (err) {
                console.error('Error al eliminar robot:', err);
                return res.status(500).json({ error: 'Error al eliminar robot' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Robot no encontrado' });
            }
            
            res.json({ message: 'Robot eliminado exitosamente' });
        });
    });
});

// ===== API DE ZONAS =====

// API para obtener todas las zonas
app.get('/api/admin/zones', requireTechOrAdmin, (req, res) => {
    const query = `
        SELECT id, name, description, polygon, bounds, created_at
        FROM zones 
        ORDER BY created_at DESC
    `;
    
    db.all(query, [], (err, zones) => {
        if (err) {
            console.error('Error al obtener zonas:', err);
            return res.status(500).json({ error: 'Error al obtener zonas' });
        }
        
        // Parsear bounds como JSON si existe
        const processedZones = zones.map(zone => ({
            ...zone,
            bounds: zone.bounds ? JSON.parse(zone.bounds) : null
        }));
        
        res.json(processedZones);
    });
});

// API para obtener una zona específica
app.get('/api/admin/zones/:id', requireTechOrAdmin, (req, res) => {
    const zoneId = req.params.id;
    const query = `
        SELECT id, name, description, polygon, bounds, created_at
        FROM zones 
        WHERE id = ?
    `;
    
    db.get(query, [zoneId], (err, zone) => {
        if (err) {
            console.error('Error al obtener zona:', err);
            return res.status(500).json({ error: 'Error al obtener zona' });
        }
        
        if (!zone) {
            return res.status(404).json({ error: 'Zona no encontrada' });
        }
        
        // Parsear bounds como JSON si existe
        if (zone.bounds) {
            zone.bounds = JSON.parse(zone.bounds);
        }
        
        res.json(zone);
    });
});

// API para crear una nueva zona
app.post('/api/admin/zones', requireTechOrAdmin, (req, res) => {
    const { name, description, polygon, bounds } = req.body;
    
    if (!name || !polygon) {
        return res.status(400).json({ error: 'El nombre y polígono son obligatorios' });
    }
    
    // Validar que el polígono tenga exactamente 4 puntos
    let parsedPolygon;
    try {
        parsedPolygon = typeof polygon === 'string' ? JSON.parse(polygon) : polygon;
        if (!Array.isArray(parsedPolygon) || parsedPolygon.length !== 4) {
            return res.status(400).json({ error: 'El polígono debe tener exactamente 4 puntos' });
        }
        
        // Validar estructura de cada punto
        for (const point of parsedPolygon) {
            if (typeof point.x !== 'number' || typeof point.y !== 'number') {
                return res.status(400).json({ error: 'Cada punto debe tener coordenadas x,y válidas' });
            }
        }
    } catch (error) {
        return res.status(400).json({ error: 'Formato de polígono inválido' });
    }
    
    // Calcular valores legacy para compatibilidad (basados en bounding box)
    const minX = Math.min(...parsedPolygon.map(p => p.x));
    const maxX = Math.max(...parsedPolygon.map(p => p.x));
    const minY = Math.min(...parsedPolygon.map(p => p.y));
    const maxY = Math.max(...parsedPolygon.map(p => p.y));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const width = maxX - minX;
    const height = maxY - minY;
    
    const query = `
        INSERT INTO zones (name, description, polygon, bounds, x, y, width, height, type, color, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'polygon', '#ff6600', datetime('now'))
    `;
    
    const polygonString = JSON.stringify(parsedPolygon);
    const boundsString = bounds ? JSON.stringify(bounds) : null;
    
    db.run(query, [name, description, polygonString, boundsString, centerX, centerY, width, height], function(err) {
        if (err) {
            console.error('Error al crear zona:', err);
            return res.status(500).json({ error: 'Error al crear zona' });
        }
        
        res.status(201).json({
            message: 'Zona creada exitosamente',
            id: this.lastID,
            zone: {
                id: this.lastID,
                name,
                description,
                polygon: parsedPolygon,
                bounds
            }
        });
    });
});

// API para actualizar una zona
app.put('/api/admin/zones/:id', requireTechOrAdmin, (req, res) => {
    const zoneId = req.params.id;
    const { name, description, polygon, bounds } = req.body;
    
    if (!name || !polygon) {
        return res.status(400).json({ error: 'El nombre y polígono son obligatorios' });
    }
    
    // Validar que el polígono tenga exactamente 4 puntos
    let parsedPolygon;
    try {
        parsedPolygon = typeof polygon === 'string' ? JSON.parse(polygon) : polygon;
        if (!Array.isArray(parsedPolygon) || parsedPolygon.length !== 4) {
            return res.status(400).json({ error: 'El polígono debe tener exactamente 4 puntos' });
        }
        
        // Validar estructura de cada punto
        for (const point of parsedPolygon) {
            if (typeof point.x !== 'number' || typeof point.y !== 'number') {
                return res.status(400).json({ error: 'Cada punto debe tener coordenadas x,y válidas' });
            }
        }
    } catch (error) {
        return res.status(400).json({ error: 'Formato de polígono inválido' });
    }
    
    // Calcular valores para campos legacy basados en el polígono
    const minX = Math.min(...parsedPolygon.map(p => p.x));
    const maxX = Math.max(...parsedPolygon.map(p => p.x));
    const minY = Math.min(...parsedPolygon.map(p => p.y));
    const maxY = Math.max(...parsedPolygon.map(p => p.y));
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const width = maxX - minX;
    const height = maxY - minY;

    const query = `
        UPDATE zones 
        SET name = ?, description = ?, polygon = ?, bounds = ?, x = ?, y = ?, width = ?, height = ?
        WHERE id = ?
    `;
    
    const polygonString = JSON.stringify(parsedPolygon);
    const boundsString = bounds ? JSON.stringify(bounds) : null;
    
    db.run(query, [name, description, polygonString, boundsString, centerX, centerY, width, height, zoneId], function(err) {
        if (err) {
            console.error('Error al actualizar zona:', err);
            return res.status(500).json({ error: 'Error al actualizar zona' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Zona no encontrada' });
        }
        
        res.json({
            message: 'Zona actualizada exitosamente',
            zone: {
                id: zoneId,
                name,
                description,
                polygon: parsedPolygon,
                bounds
            }
        });
    });
});

// API para eliminar una zona
app.delete('/api/admin/zones/:id', requireTechOrAdmin, (req, res) => {
    const zoneId = req.params.id;
    
    const query = `DELETE FROM zones WHERE id = ?`;
    
    db.run(query, [zoneId], function(err) {
        if (err) {
            console.error('Error al eliminar zona:', err);
            return res.status(500).json({ error: 'Error al eliminar zona' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Zona no encontrada' });
        }
        
        res.json({ message: 'Zona eliminada exitosamente' });
    });
});

// ===== RUTAS DEL ROBOT =====

// Servir la página de control del robot (acceso para técnicos y admins)
app.get('/robot', requireTechOrAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'robot.html'));
});

// API para obtener estado del robot
app.get('/api/robot/status', requireAuth, (req, res) => {
    const status = robotManager.getStatus();
    
    res.json({
        ...status,
        topics_available: robotManager.topics
    });
});

// API para comandos básicos del robot
app.post('/api/robot/command', requireAuth, (req, res) => {
    const { action, parameters = {} } = req.body;
    let result;
    
    try {
        switch (action) {
            case 'move_forward':
                result = robotManager.moveForward(parameters.speed || 0.2);
                break;
            case 'move_backward':
                result = robotManager.moveBackward(parameters.speed || 0.2);
                break;
            case 'turn_left':
                result = robotManager.turnLeft(parameters.speed || 0.5);
                break;
            case 'turn_right':
                result = robotManager.turnRight(parameters.speed || 0.5);
                break;
            case 'stop':
                result = robotManager.stopRobot();
                break;
            case 'custom_velocity':
                result = robotManager.sendVelocityCommand(
                    parameters.linear || 0, 
                    parameters.angular || 0
                );
                break;
            default:
                return res.status(400).json({ error: 'Acción no reconocida' });
        }
        
        // Log de la acción en la base de datos
        const logQuery = `INSERT INTO robot_commands (user_id, action, parameters, timestamp) 
                          VALUES (?, ?, ?, datetime('now'))`;
        
        // Crear tabla de comandos si no existe
        db.run(`CREATE TABLE IF NOT EXISTS robot_commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT,
            parameters TEXT,
            timestamp DATETIME,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
            if (err && !err.message.includes('already exists')) {
                console.log('Tabla robot_commands creada');
            }
        });
        
        db.run(logQuery, [req.session.userId, action, JSON.stringify(parameters)], function(err) {
            if (err) {
                console.error('Error al registrar comando:', err.message);
            }
        });
        
        res.json({ 
            success: result.success, 
            message: result.message || result.error,
            action: action,
            parameters: parameters,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// API para obtener información detallada del robot
app.get('/api/robot/info', requireAuth, (req, res) => {
    const status = robotManager.getStatus();
    
    res.json({
        connection_status: status,
        available_actions: [
            'move_forward',
            'move_backward', 
            'turn_left',
            'turn_right',
            'stop',
            'custom_velocity'
        ]
    });
});

// API para obtener lista de tópicos en tiempo real
app.get('/api/robot/topics', requireAuth, (req, res) => {
    if (!robotManager.connected) {
        return res.status(503).json({ 
            error: 'Robot no conectado',
            topics: []
        });
    }

    // Obtener tópicos reales del robot vía rosbridge
    try {
        // En una implementación real, esto obtendría los tópicos directamente del robot
        // robotManager.getTopics() debería retornar una promesa con los tópicos reales
        res.json({
            success: true,
            topic_count: robotManager.topics.length,
            topics: robotManager.topics,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Error al obtener tópicos del robot',
            message: error.message
        });
    }
});

// API para obtener datos del mapa
app.get('/api/robot/map', requireAuth, (req, res) => {
    if (!robotManager.connected) {
        return res.status(503).json({ 
            error: 'Robot no conectado',
            map: null
        });
    }

    try {
        // Suscribirse al tópico del mapa si no está ya suscrito
        if (!robotManager.subscribers.has('/map')) {
            robotManager.subscribe('/map', 'nav_msgs/OccupancyGrid', (mapData) => {
                robotManager.currentMap = mapData;
            });
        }

        res.json({
            success: true,
            map: robotManager.currentMap || null,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Error al obtener datos del mapa',
            message: error.message
        });
    }
});

// API para obtener posición del robot
app.get('/api/robot/pose', requireAuth, (req, res) => {
    if (!robotManager.connected) {
        return res.status(503).json({ 
            error: 'Robot no conectado',
            pose: null
        });
    }

    try {
        res.json({
            success: true,
            amcl_pose: robotManager.amclPose || null,
            odom_pose: robotManager.odomPose || null,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Error al obtener posición del robot',
            message: error.message
        });
    }
});

// API para hacer que el robot hable
app.post('/api/robot/speak', requireAuth, (req, res) => {
    if (!robotManager.connected) {
        return res.status(503).json({ 
            error: 'Robot no conectado'
        });
    }

    const { text } = req.body;

    // Validar que se proporcione texto
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({
            error: 'Se requiere un texto válido para que el robot hable'
        });
    }

    // Limitar longitud del texto (máximo 500 caracteres)
    const cleanText = text.trim();
    if (cleanText.length > 500) {
        return res.status(400).json({
            error: 'El texto es demasiado largo (máximo 500 caracteres)'
        });
    }

    try {
        // Enviar mensaje al tópico /voice del robot
        const voiceMessage = {
            data: cleanText
        };

        robotManager.publish('/voice', 'std_msgs/String', voiceMessage);
        console.log(`🗣️ Mensaje de voz enviado al robot: "${cleanText.substring(0, 50)}${cleanText.length > 50 ? '...' : ''}"`);

        res.json({
            success: true,
            message: 'Comando de voz enviado al robot',
            text: cleanText,
            topic: '/voice',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error enviando comando de voz al robot:', error);
        res.status(500).json({
            error: 'Error al enviar comando de voz al robot',
            message: error.message,
            details: 'Verifica que el robot esté conectado y el tópico /voice esté disponible'
        });
    }
});

// WebSocket para datos del mapa en tiempo real
app.ws('/api/robot/map-stream', (ws, req) => {
    console.log('Cliente conectado al stream del mapa desde:', req.ip);

    // Verificar autenticación - temporalmente más permisivo para depuración
    if (!req.session || !req.session.user) {
        console.log('⚠️ Cliente sin sesión válida, pero permitiendo conexión para depuración');
    } else {
        console.log('✅ Cliente autenticado:', req.session.user.username);
    }

    let mapSubscribed = false;
    let poseSubscribed = false;

    // Función para enviar datos del mapa
    const sendMapData = () => {
        if (robotManager.connected && robotManager.currentMap) {
            ws.send(JSON.stringify({
                type: 'map',
                data: robotManager.currentMap,
                timestamp: new Date().toISOString()
            }));
        }
    };

    // Función para enviar datos de posición
    const sendPoseData = () => {
        if (robotManager.connected && (robotManager.amclPose || robotManager.odomPose)) {
            ws.send(JSON.stringify({
                type: 'pose',
                data: {
                    amcl: robotManager.amclPose,
                    odom: robotManager.odomPose
                },
                timestamp: new Date().toISOString()
            }));
        }
    };

    // Suscribirse a los tópicos del robot
    if (robotManager.connected) {
        console.log('🔗 Robot conectado, suscribiendo a tópicos...');
        try {
            // Suscribirse al mapa
            if (!robotManager.subscribers.has('/map')) {
                console.log('📍 Suscribiendo al tópico /map');
                robotManager.subscribe('/map', 'nav_msgs/OccupancyGrid', (mapData) => {
                    console.log('🗺️ Datos del mapa recibidos');
                    robotManager.currentMap = mapData;
                    sendMapData();
                });
                mapSubscribed = true;
            } else {
                console.log('📍 Ya suscrito al tópico /map');
            }

            // Suscribirse a la posición AMCL
            if (!robotManager.subscribers.has('/amcl_pose')) {
                console.log('🤖 Suscribiendo al tópico /amcl_pose');
                robotManager.subscribe('/amcl_pose', 'geometry_msgs/PoseWithCovarianceStamped', (poseData) => {
                    console.log('📍 Posición AMCL recibida');
                    robotManager.amclPose = poseData;
                    sendPoseData();
                });
                poseSubscribed = true;
            } else {
                console.log('🤖 Ya suscrito al tópico /amcl_pose');
            }

            // Suscribirse a la posición del EKF
            if (!robotManager.subscribers.has('/robot_pose_ekf/odom_combined')) {
                console.log('🔍 Suscribiendo al tópico /robot_pose_ekf/odom_combined');
                robotManager.subscribe('/robot_pose_ekf/odom_combined', 'geometry_msgs/PoseWithCovarianceStamped', (poseData) => {
                    console.log('📍 Posición EKF recibida');
                    robotManager.odomPose = poseData;
                    sendPoseData();
                });
            } else {
                console.log('🔍 Ya suscrito al tópico /robot_pose_ekf/odom_combined');
            }

            // Enviar datos iniciales si están disponibles
            console.log('📤 Enviando datos iniciales al cliente...');
            sendMapData();
            sendPoseData();

            // Enviar mensaje de estado de conexión exitosa
            ws.send(JSON.stringify({
                type: 'status',
                message: 'Conectado a ROS Bridge exitosamente',
                connected: true,
                topics: ['/map', '/amcl_pose', '/robot_pose_ekf/odom_combined']
            }));

        } catch (error) {
            console.error('❌ Error al suscribirse a tópicos:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Error al suscribirse a tópicos: ' + error.message
            }));
        }
    } else {
        console.log('❌ Robot no conectado');
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Robot no conectado'
        }));
    }

    ws.on('close', () => {
        console.log('Cliente desconectado del stream del mapa');
        // No desuscribirse de los tópicos ya que otros clientes pueden estar usando
    });

    ws.on('error', (error) => {
        console.error('Error en WebSocket del mapa:', error);
    });
});

// API para historial de comandos del robot (solo admin)
app.get('/api/admin/robot/commands', requireAuth, requireTechOrAdmin, (req, res) => {
    const query = `
        SELECT rc.*, u.username 
        FROM robot_commands rc
        JOIN users u ON rc.user_id = u.id
        ORDER BY rc.timestamp DESC
        LIMIT 100
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// ========== ENDPOINTS DE NOTIFICACIONES POR EMAIL ==========

// API para enviar notificación de tour abandonado
app.post('/api/tour/abandon', requireAuth, (req, res) => {
    const { tour_id, progress } = req.body;
    
    if (!tour_id) {
        return res.status(400).json({ error: 'tour_id requerido' });
    }
    
    // Obtener información del tour
    db.get(`
        SELECT th.*, tr.name as tour_name, u.username
        FROM tour_history th
        LEFT JOIN tour_routes tr ON th.tour_route_id = tr.id
        LEFT JOIN users u ON th.user_id = u.id
        WHERE th.tour_id = ? AND th.completed = 0
    `, [tour_id], (err, tour) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener tour' });
        }
        
        if (tour) {
            // Enviar notificación de tour abandonado
            emailNotifier.sendNotification('TOUR_ABANDONED', {
                tourName: tour.tour_name,
                username: tour.username,
                progress: progress || 0
            });
        }
        
        res.json({ success: true, message: 'Notificación de abandono enviada' });
    });
});

// API para probar el sistema de notificaciones (solo admin)
app.post('/api/admin/test-notification', requireTechOrAdmin, (req, res) => {
    const { type, testData } = req.body;
    
    if (!type) {
        return res.status(400).json({ error: 'Tipo de notificación requerido' });
    }
    
    const sampleData = {
        USER_CREATED: {
            username: 'usuario_prueba',
            email: 'prueba@test.com',
            role: 'user'
        },
        USER_DELETED: {
            username: 'usuario_eliminado',
            email: 'eliminado@test.com'
        },
        TOUR_STARTED: {
            tourName: 'Tour de Prueba',
            username: 'usuario_test',
            routeName: 'Ruta de Prueba'
        },
        TOUR_COMPLETED: {
            tourName: 'Tour de Prueba',
            username: 'usuario_test',
            duration: 15,
            rating: 5
        },
        TOUR_ABANDONED: {
            tourName: 'Tour de Prueba',
            username: 'usuario_test',
            progress: 50
        },
        BATTERY_LOW: {
            batteryLevel: 15,
            location: 'Sala Principal'
        },
        BATTERY_CRITICAL: {
            batteryLevel: 5,
            location: 'Entrada'
        },
        ROBOT_ERROR: {
            error: 'Error de navegación',
            details: 'No se puede alcanzar el objetivo'
        },
        ROBOT_DISCONNECTED: {
            lastLocation: 'Sala 2'
        },
        ROBOT_RECONNECTED: {
            location: 'Base de carga'
        },
        ROUTE_CREATED: {
            routeName: 'Nueva Ruta de Prueba',
            waypointCount: 5,
            createdBy: 'admin'
        },
        ROUTE_DELETED: {
            routeName: 'Ruta Eliminada',
            toursCount: 3,
            deletedBy: 'admin'
        },
        SYSTEM_ERROR: {
            error: 'Error de base de datos',
            component: 'SQLite',
            details: 'Conexión perdida'
        }
    };
    
    const data = testData || sampleData[type];
    
    if (!data) {
        return res.status(400).json({ error: 'Tipo de notificación no válido' });
    }
    
    emailNotifier.sendNotification(type, data)
        .then(success => {
            if (success) {
                res.json({ success: true, message: `Notificación de prueba ${type} enviada` });
            } else {
                res.status(500).json({ error: 'Error al enviar notificación' });
            }
        })
        .catch(error => {
            res.status(500).json({ error: 'Error al enviar notificación: ' + error.message });
        });
});

// API para obtener estado del sistema de notificaciones (solo admin)
app.get('/api/admin/notification-status', requireTechOrAdmin, async (req, res) => {
    try {
        const status = await emailNotifier.testConnection();
        res.json({
            enabled: emailNotifier.isEnabled,
            connectionStatus: status,
            robotStatus: robotManager.getStatus()
        });
    } catch (error) {
        res.json({
            enabled: false,
            connectionStatus: { success: false, message: error.message },
            robotStatus: robotManager.getStatus()
        });
    }
});

// API para activar/desactivar notificaciones (solo admin)
app.post('/api/admin/notifications/toggle', requireTechOrAdmin, (req, res) => {
    const { enabled } = req.body;
    
    if (enabled === true) {
        emailNotifier.enable();
        res.json({ success: true, message: 'Notificaciones habilitadas' });
    } else if (enabled === false) {
        emailNotifier.disable();
        res.json({ success: true, message: 'Notificaciones deshabilitadas' });
    } else {
        res.status(400).json({ error: 'Parámetro enabled requerido (true/false)' });
    }
});

// ========== FIN ENDPOINTS DE NOTIFICACIONES ==========

// ========== ENDPOINTS DE ZONAS ==========

// Obtener todas las zonas
app.get('/api/zones', requireAuth, (req, res) => {
    db.all('SELECT * FROM zones ORDER BY created_at DESC', [], (err, zones) => {
        if (err) {
            console.error('Error al obtener zonas:', err);
            res.status(500).json({ error: 'Error al obtener zonas' });
        } else {
            // Procesar zonas para compatibilidad con frontend
            const processedZones = zones.map(zone => {
                const processedZone = { ...zone };
                
                // Si tiene puntos en JSON, parsearlos
                if (zone.points) {
                    try {
                        processedZone.points = JSON.parse(zone.points);
                        processedZone.type = zone.type || 'polygon';
                    } catch (e) {
                        console.error('Error parseando puntos de zona:', e);
                        // Fallback a datos rectangulares si existen
                        if (zone.x !== null && zone.y !== null && zone.width !== null && zone.height !== null) {
                            processedZone.points = [
                                { x: zone.x, y: zone.y },
                                { x: zone.x + zone.width, y: zone.y },
                                { x: zone.x + zone.width, y: zone.y + zone.height },
                                { x: zone.x, y: zone.y + zone.height }
                            ];
                            processedZone.type = 'polygon';
                        }
                    }
                } else if (zone.x !== null && zone.y !== null && zone.width !== null && zone.height !== null) {
                    // Zona rectangular legacy - convertir a puntos
                    processedZone.points = [
                        { x: zone.x, y: zone.y },
                        { x: zone.x + zone.width, y: zone.y },
                        { x: zone.x + zone.width, y: zone.y + zone.height },
                        { x: zone.x, y: zone.y + zone.height }
                    ];
                    processedZone.type = 'polygon';
                }
                
                return processedZone;
            });
            
            res.json(processedZones);
        }
    });
});

// Crear nueva zona
app.post('/api/zones', requireAuth, (req, res) => {
    const { name, points, color, type } = req.body;
    
    // Validaciones básicas
    if (!name) {
        return res.status(400).json({ error: 'El nombre de la zona es requerido' });
    }
    
    // Validar puntos
    if (!points || !Array.isArray(points) || points.length !== 4) {
        return res.status(400).json({ error: 'Se requieren exactamente 4 puntos para la zona' });
    }
    
    // Validar que cada punto tenga x e y
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (typeof point.x !== 'number' || typeof point.y !== 'number') {
            return res.status(400).json({ error: `Punto ${i + 1} tiene coordenadas inválidas` });
        }
    }
    
    // Verificar que el nombre no esté duplicado
    db.get('SELECT id FROM zones WHERE name = ?', [name], (err, existingZone) => {
        if (err) {
            console.error('Error al verificar zona existente:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        
        if (existingZone) {
            return res.status(400).json({ error: 'Ya existe una zona con este nombre' });
        }
        
        // Preparar datos para insertar
        const pointsJson = JSON.stringify(points);
        const zoneType = type || 'polygon';
        const zoneColor = color || '#ff4444';
        
        // Para compatibilidad legacy, calcular bounding box
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        const width = maxX - minX;
        const height = maxY - minY;
        
        // Crear la zona
        db.run(`INSERT INTO zones (name, points, type, color, x, y, width, height, created_by) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, pointsJson, zoneType, zoneColor, minX, minY, width, height, req.session.userId],
            function(err) {
                if (err) {
                    console.error('Error al crear zona:', err);
                    res.status(500).json({ error: 'Error al crear zona' });
                } else {
                    res.json({
                        success: true,
                        id: this.lastID,
                        message: 'Zona creada exitosamente'
                    });
                }
            }
        );
    });
});

// Obtener zona específica
app.get('/api/zones/:id', requireAuth, (req, res) => {
    const zoneId = req.params.id;
    
    db.get('SELECT * FROM zones WHERE id = ?', [zoneId], (err, zone) => {
        if (err) {
            console.error('Error al obtener zona:', err);
            res.status(500).json({ error: 'Error al obtener zona' });
        } else if (!zone) {
            res.status(404).json({ error: 'Zona no encontrada' });
        } else {
            res.json(zone);
        }
    });
});

// API para que el robot consulte en qué zona se encuentra basándose en coordenadas
app.post('/api/robot/location/zone', (req, res) => {
    const { x, y, robot_id } = req.body;
    
    // Validar parámetros requeridos
    if (typeof x !== 'number' || typeof y !== 'number') {
        return res.status(400).json({
            success: false,
            error: 'Coordenadas x e y son requeridas y deben ser números',
            received: { x, y, robot_id }
        });
    }
    
    console.log(`🤖 Robot ${robot_id || 'desconocido'} consultando zona para coordenadas (${x}, ${y})`);
    
    // Obtener todas las zonas de la base de datos
    db.all('SELECT * FROM zones ORDER BY created_at DESC', [], (err, zones) => {
        if (err) {
            console.error('Error al consultar zonas:', err);
            return res.status(500).json({
                success: false,
                error: 'Error al consultar zonas en la base de datos'
            });
        }
        
        if (!zones || zones.length === 0) {
            return res.json({
                success: true,
                found: false,
                zone: null,
                coordinates: { x, y },
                robot_id: robot_id || null,
                message: 'No hay zonas definidas en el sistema'
            });
        }
        
        // Función para verificar si un punto está dentro de un polígono (algoritmo Ray Casting)
        function pointInPolygon(point, polygon) {
            const { x, y } = point;
            let inside = false;
            
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                if (((polygon[i].y > y) !== (polygon[j].y > y)) &&
                    (x < (polygon[j].x - polygon[i].x) * (y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
                    inside = !inside;
                }
            }
            
            return inside;
        }
        
        // Función para verificar si un punto está dentro de un rectángulo
        function pointInRectangle(point, rect) {
            const { x, y } = point;
            return (x >= rect.x && x <= (rect.x + rect.width) &&
                    y >= rect.y && y <= (rect.y + rect.height));
        }
        
        // Buscar en qué zona se encuentra el robot
        let foundZone = null;
        
        for (const zone of zones) {
            let isInside = false;
            
            // Verificar según el tipo de zona
            if (zone.type === 'polygon' && zone.points) {
                try {
                    const points = JSON.parse(zone.points);
                    if (Array.isArray(points) && points.length >= 3) {
                        isInside = pointInPolygon({ x, y }, points);
                    }
                } catch (e) {
                    console.error(`Error parseando puntos de zona ${zone.name}:`, e);
                }
            } else if (zone.type === 'rectangle' || (!zone.type && zone.x !== null && zone.y !== null)) {
                // Zona rectangular (legacy o explícita)
                if (zone.x !== null && zone.y !== null && zone.width !== null && zone.height !== null) {
                    isInside = pointInRectangle({ x, y }, {
                        x: zone.x,
                        y: zone.y,
                        width: zone.width,
                        height: zone.height
                    });
                }
            }
            
            if (isInside) {
                foundZone = zone;
                break; // Tomar la primera zona encontrada (más reciente)
            }
        }
        
        // Preparar respuesta
        if (foundZone) {
            console.log(`✅ Robot ${robot_id || 'desconocido'} se encuentra en zona: "${foundZone.name}"`);
            
            // Preparar información de la zona encontrada
            let zoneInfo = {
                id: foundZone.id,
                name: foundZone.name,
                type: foundZone.type || 'rectangle',
                color: foundZone.color,
                created_at: foundZone.created_at
            };
            
            // Agregar información geométrica según el tipo
            if (foundZone.type === 'polygon' && foundZone.points) {
                try {
                    zoneInfo.points = JSON.parse(foundZone.points);
                } catch (e) {
                    console.error('Error parseando puntos:', e);
                }
            } else if (foundZone.x !== null && foundZone.y !== null) {
                zoneInfo.bounds = {
                    x: foundZone.x,
                    y: foundZone.y,
                    width: foundZone.width,
                    height: foundZone.height
                };
            }
            
            res.json({
                success: true,
                found: true,
                zone: zoneInfo,
                coordinates: { x, y },
                robot_id: robot_id || null,
                message: `Robot se encuentra en la zona "${foundZone.name}"`,
                timestamp: new Date().toISOString()
            });
        } else {
            console.log(`❌ Robot ${robot_id || 'desconocido'} no se encuentra en ninguna zona definida (${x}, ${y})`);
            
            res.json({
                success: true,
                found: false,
                zone: null,
                coordinates: { x, y },
                robot_id: robot_id || null,
                message: 'Robot no se encuentra en ninguna zona definida',
                zones_checked: zones.length,
                timestamp: new Date().toISOString()
            });
        }
    });
});

// API para que el robot consulte múltiples coordenadas a la vez (útil para trayectorias)
app.post('/api/robot/location/zones-batch', (req, res) => {
    const { coordinates, robot_id } = req.body;
    
    // Validar parámetros
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Se requiere un array de coordenadas no vacío',
            received: { coordinates, robot_id }
        });
    }
    
    // Validar formato de coordenadas
    for (let i = 0; i < coordinates.length; i++) {
        const coord = coordinates[i];
        if (typeof coord.x !== 'number' || typeof coord.y !== 'number') {
            return res.status(400).json({
                success: false,
                error: `Coordenada ${i}: x e y deben ser números`,
                received: coord
            });
        }
    }
    
    console.log(`🤖 Robot ${robot_id || 'desconocido'} consultando ${coordinates.length} coordenadas`);
    
    // Obtener todas las zonas
    db.all('SELECT * FROM zones ORDER BY created_at DESC', [], (err, zones) => {
        if (err) {
            console.error('Error al consultar zonas:', err);
            return res.status(500).json({
                success: false,
                error: 'Error al consultar zonas en la base de datos'
            });
        }
        
        // Funciones de detección (reutilizadas del endpoint anterior)
        function pointInPolygon(point, polygon) {
            const { x, y } = point;
            let inside = false;
            
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                if (((polygon[i].y > y) !== (polygon[j].y > y)) &&
                    (x < (polygon[j].x - polygon[i].x) * (y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
                    inside = !inside;
                }
            }
            
            return inside;
        }
        
        function pointInRectangle(point, rect) {
            const { x, y } = point;
            return (x >= rect.x && x <= (rect.x + rect.width) &&
                    y >= rect.y && y <= (rect.y + rect.height));
        }
        
        function findZoneForPoint(x, y) {
            for (const zone of zones) {
                let isInside = false;
                
                if (zone.type === 'polygon' && zone.points) {
                    try {
                        const points = JSON.parse(zone.points);
                        if (Array.isArray(points) && points.length >= 3) {
                            isInside = pointInPolygon({ x, y }, points);
                        }
                    } catch (e) {
                        console.error(`Error parseando puntos de zona ${zone.name}:`, e);
                    }
                } else if (zone.type === 'rectangle' || (!zone.type && zone.x !== null && zone.y !== null)) {
                    if (zone.x !== null && zone.y !== null && zone.width !== null && zone.height !== null) {
                        isInside = pointInRectangle({ x, y }, {
                            x: zone.x,
                            y: zone.y,
                            width: zone.width,
                            height: zone.height
                        });
                    }
                }
                
                if (isInside) {
                    return {
                        id: zone.id,
                        name: zone.name,
                        type: zone.type || 'rectangle',
                        color: zone.color
                    };
                }
            }
            return null;
        }
        
        // Procesar todas las coordenadas
        const results = coordinates.map((coord, index) => {
            const zone = findZoneForPoint(coord.x, coord.y);
            return {
                index: index,
                coordinates: { x: coord.x, y: coord.y },
                zone: zone,
                found: !!zone
            };
        });
        
        const zonesFound = results.filter(r => r.found).length;
        console.log(`✅ Robot ${robot_id || 'desconocido'}: ${zonesFound}/${coordinates.length} coordenadas en zonas`);
        
        res.json({
            success: true,
            robot_id: robot_id || null,
            total_coordinates: coordinates.length,
            coordinates_in_zones: zonesFound,
            coordinates_outside_zones: coordinates.length - zonesFound,
            results: results,
            timestamp: new Date().toISOString()
        });
    });
});

// API para que el robot obtenga la lista de todas las zonas disponibles
app.get('/api/robot/zones', (req, res) => {
    const { robot_id } = req.query;
    
    
    db.all('SELECT * FROM zones ORDER BY created_at DESC', [], (err, zones) => {
        if (err) {
            console.error('Error al obtener zonas para robot:', err);
            return res.status(500).json({
                success: false,
                error: 'Error al consultar zonas'
            });
        }
        
        
        if (zones.length === 0) {
            return res.json({
                success: true,
                robot_id: robot_id || null,
                zones_count: 0,
                zones: [],
                timestamp: new Date().toISOString(),
                message: 'No hay zonas definidas'
            });
        }
        
        // Procesar zonas para el robot (formato simplificado)
        const robotZones = zones.map(zone => {
            const robotZone = {
                id: zone.id,
                name: zone.name,
                description: zone.description,
                type: 'polygon', // Todas las zonas son polígonos ahora
                color: zone.color || '#ff6600',
                created_at: zone.created_at
            };
            
            // Agregar información geométrica desde la nueva estructura
            if (zone.polygon) {
                try {
                    robotZone.polygon = JSON.parse(zone.polygon);
                    
                    // Usar bounds existentes si están disponibles
                    if (zone.bounds) {
                        robotZone.bounds = JSON.parse(zone.bounds);
                    } else {
                        // Calcular bounds del polígono si no están disponibles
                        const points = robotZone.polygon;
                        if (Array.isArray(points) && points.length > 0) {
                            const xs = points.map(p => p.x);
                            const ys = points.map(p => p.y);
                            robotZone.bounds = {
                                min_x: Math.min(...xs),
                                max_x: Math.max(...xs),
                                min_y: Math.min(...ys),
                                max_y: Math.max(...ys),
                                center_x: xs.reduce((sum, x) => sum + x, 0) / xs.length,
                                center_y: ys.reduce((sum, y) => sum + y, 0) / ys.length,
                                area: calculatePolygonArea(points)
                            };
                        }
                    }
                } catch (e) {
                    console.error('Error parseando polígono de zona:', e);
                }
            } else if (zone.x !== null && zone.y !== null && zone.width !== null && zone.height !== null) {
                // Compatibilidad con estructura legacy - convertir a polígono
                robotZone.polygon = [
                    { x: zone.x, y: zone.y },
                    { x: zone.x + zone.width, y: zone.y },
                    { x: zone.x + zone.width, y: zone.y + zone.height },
                    { x: zone.x, y: zone.y + zone.height }
                ];
                robotZone.bounds = {
                    min_x: zone.x,
                    max_x: zone.x + zone.width,
                    min_y: zone.y,
                    max_y: zone.y + zone.height,
                    center_x: zone.x + zone.width / 2,
                    center_y: zone.y + zone.height / 2,
                    area: zone.width * zone.height
                };
            }
            
            return robotZone;
        });
        
        
        res.json({
            success: true,
            robot_id: robot_id || null,
            zones_count: robotZones.length,
            zones: robotZones,
            timestamp: new Date().toISOString()
        });
    });
});

// API para enviar comandos de navegación al robot (control desde panel web)
app.post('/api/robot/navigate-to-zone', requireAuth, async (req, res) => {
    const { zone_id, coordinates, robot_id } = req.body;
    
    if (!zone_id && !coordinates) {
        return res.status(400).json({
            success: false,
            error: 'zone_id o coordinates son requeridos'
        });
    }
    
    const robotName = robot_id || 'roberto';
    
    try {
        let targetZone = null;
        let targetX, targetY;
        
        if (zone_id) {
            // Buscar la zona por ID
            const zoneQuery = 'SELECT * FROM zones WHERE id = ?';
            
            await new Promise((resolve, reject) => {
                db.get(zoneQuery, [zone_id], (err, zone) => {
                    if (err) reject(err);
                    else if (!zone) reject(new Error('Zona no encontrada'));
                    else {
                        targetZone = zone;
                        
                        // Calcular centro de la zona
                        if (zone.type === 'polygon' && zone.points) {
                            const points = JSON.parse(zone.points);
                            const bounds = calculatePolygonBounds(points);
                            if (bounds && bounds.center) {
                                targetX = bounds.center.x;
                                targetY = bounds.center.y;
                            } else {
                                reject(new Error('No se pueden calcular coordenadas del polígono'));
                            }
                        } else if (zone.x !== null && zone.y !== null && zone.width !== null && zone.height !== null) {
                            targetX = zone.x + zone.width / 2;
                            targetY = zone.y + zone.height / 2;
                        } else {
                            reject(new Error('Zona sin coordenadas válidas'));
                        }
                        resolve();
                    }
                });
            });
        } else {
            // Usar coordenadas directas
            targetX = coordinates.x;
            targetY = coordinates.y;
        }
        
        console.log(`🤖 Panel de control ordenó navegación del robot ${robotName} a:`);
        if (targetZone) {
            console.log(`   Zona: ${targetZone.name} (ID: ${targetZone.id})`);
        }
        console.log(`   Coordenadas: (${targetX.toFixed(2)}, ${targetY.toFixed(2)})`);
        
        // Registrar el comando de navegación en la base de datos (opcional)
        const navigationCommand = {
            robot_id: robotName,
            command_type: 'navigate_to_zone',
            target_zone_id: zone_id || null,
            target_zone_name: targetZone ? targetZone.name : 'Coordenadas directas',
            target_x: targetX,
            target_y: targetY,
            timestamp: new Date().toISOString(),
            issued_by: req.session.userId
        };
        
        // Respuesta exitosa
        res.json({
            success: true,
            message: 'Comando de navegación enviado al robot',
            navigation: {
                robot_id: robotName,
                target_zone: targetZone ? {
                    id: targetZone.id,
                    name: targetZone.name,
                    type: targetZone.type
                } : null,
                target_coordinates: {
                    x: targetX,
                    y: targetY
                },
                estimated_distance: null, // Podríamos calcular esto
                timestamp: navigationCommand.timestamp
            },
            feedback: {
                type: 'navigation_command_sent',
                description: `Robot ${robotName} recibió orden de navegación a ${targetZone ? targetZone.name : 'coordenadas específicas'}`,
                action: 'navigate',
                robot_response_expected: true
            }
        });
        
    } catch (error) {
        console.error('Error enviando comando de navegación:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error interno del servidor'
        });
    }
});

// API para obtener estado actual de navegación del robot
app.get('/api/robot/:robotId/navigation-status', requireAuth, (req, res) => {
    const robotId = req.params.robotId;
    
    // Por ahora, devolver un estado simulado
    // En una implementación real, esto consultaría el estado del robot desde ROS
    res.json({
        success: true,
        robot_id: robotId,
        navigation_status: {
            is_navigating: false,
            current_goal: null,
            current_position: {
                x: 0.0,
                y: 0.0,
                orientation: 0.0
            },
            current_zone: null,
            status: 'idle',
            last_navigation_time: null,
            estimated_arrival: null
        },
        timestamp: new Date().toISOString()
    });
});

// API para cancelar navegación actual del robot
app.post('/api/robot/:robotId/cancel-navigation', requireAuth, (req, res) => {
    const robotId = req.params.robotId;
    const { reason } = req.body;
    
    console.log(`🛑 Panel de control canceló navegación del robot ${robotId}. Razón: ${reason || 'No especificada'}`);
    
    // En una implementación real, esto enviaría un comando de cancelación via ROS
    res.json({
        success: true,
        message: 'Navegación cancelada',
        robot_id: robotId,
        cancelled_at: new Date().toISOString(),
        reason: reason || 'Cancelación manual desde panel de control',
        feedback: {
            type: 'navigation_cancelled',
            description: `Navegación del robot ${robotId} cancelada desde panel de control`,
            action: 'cancel_navigation'
        }
    });
});

// API para obtener historial de navegación del robot
app.get('/api/robot/:robotId/navigation-history', requireAuth, (req, res) => {
    const robotId = req.params.robotId;
    const { limit = 50 } = req.query;
    
    // Por ahora, devolver historial simulado
    // En una implementación real, esto consultaría una tabla de historial de navegación
    const mockHistory = [
        {
            id: 1,
            timestamp: new Date(Date.now() - 3600000).toISOString(), // Hace 1 hora
            target_zone: 'Entrada Principal',
            target_coordinates: { x: 0.0, y: 0.0 },
            duration_seconds: 45,
            status: 'completed',
            issued_by_user: req.session.userId
        },
        {
            id: 2,
            timestamp: new Date(Date.now() - 7200000).toISOString(), // Hace 2 horas
            target_zone: 'Sala de Arte Moderno',
            target_coordinates: { x: 5.2, y: 3.8 },
            duration_seconds: 78,
            status: 'completed',
            issued_by_user: req.session.userId
        }
    ];
    
    res.json({
        success: true,
        robot_id: robotId,
        navigation_history: mockHistory.slice(0, parseInt(limit)),
        total_navigations: mockHistory.length,
        timestamp: new Date().toISOString()
    });
});

// Función auxiliar para calcular límites de un polígono
function calculatePolygonBounds(points) {
    if (!Array.isArray(points) || points.length === 0) return null;
    
    let minX = points[0].x, maxX = points[0].x;
    let minY = points[0].y, maxY = points[0].y;
    
    for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
    }
    
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        center: {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2
        }
    };
}

// Función auxiliar para calcular el área de un polígono usando la fórmula de Shoelace
function calculatePolygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area) / 2;
}

// Actualizar zona
app.put('/api/zones/:id', requireAuth, (req, res) => {
    const zoneId = req.params.id;
    const { name, points, color, type } = req.body;
    
    // Validaciones básicas
    if (!name) {
        return res.status(400).json({ error: 'El nombre de la zona es requerido' });
    }
    
    // Validar puntos si se proporcionan
    if (points) {
        if (!Array.isArray(points) || points.length !== 4) {
            return res.status(400).json({ error: 'Se requieren exactamente 4 puntos para la zona' });
        }
        
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            if (typeof point.x !== 'number' || typeof point.y !== 'number') {
                return res.status(400).json({ error: `Punto ${i + 1} tiene coordenadas inválidas` });
            }
        }
    }
    
    // Verificar que la zona existe
    db.get('SELECT created_by FROM zones WHERE id = ?', [zoneId], (err, zone) => {
        if (err) {
            console.error('Error al verificar zona:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        
        if (!zone) {
            return res.status(404).json({ error: 'Zona no encontrada' });
        }
        
        // Solo el creador o un admin pueden modificar la zona
        db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
            if (err) {
                console.error('Error al obtener usuario:', err);
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            
            if (zone.created_by !== req.session.userId && user.role !== 'admin') {
                return res.status(403).json({ error: 'No tienes permisos para modificar esta zona' });
            }
            
            // Verificar que el nombre no esté duplicado (excepto la misma zona)
            db.get('SELECT id FROM zones WHERE name = ? AND id != ?', [name, zoneId], (err, existingZone) => {
                if (err) {
                    console.error('Error al verificar zona existente:', err);
                    return res.status(500).json({ error: 'Error interno del servidor' });
                }
                
                if (existingZone) {
                    return res.status(400).json({ error: 'Ya existe una zona con este nombre' });
                }
                
                // Preparar datos para actualizar
                const zoneColor = color || '#ff4444';
                const zoneType = type || 'polygon';
                
                if (points) {
                    // Actualizar con nuevos puntos
                    const pointsJson = JSON.stringify(points);
                    
                    // Calcular bounding box para compatibilidad legacy
                    const xs = points.map(p => p.x);
                    const ys = points.map(p => p.y);
                    const minX = Math.min(...xs);
                    const minY = Math.min(...ys);
                    const maxX = Math.max(...xs);
                    const maxY = Math.max(...ys);
                    const width = maxX - minX;
                    const height = maxY - minY;
                    
                    db.run(`UPDATE zones SET name = ?, points = ?, type = ?, color = ?, x = ?, y = ?, width = ?, height = ? 
                            WHERE id = ?`,
                        [name, pointsJson, zoneType, zoneColor, minX, minY, width, height, zoneId],
                        function(err) {
                            if (err) {
                                console.error('Error al actualizar zona:', err);
                                res.status(500).json({ error: 'Error al actualizar zona' });
                            } else {
                                res.json({
                                    success: true,
                                    message: 'Zona actualizada exitosamente'
                                });
                            }
                        }
                    );
                } else {
                    // Solo actualizar nombre y color
                    db.run(`UPDATE zones SET name = ?, color = ? WHERE id = ?`,
                        [name, zoneColor, zoneId],
                        function(err) {
                            if (err) {
                                console.error('Error al actualizar zona:', err);
                                res.status(500).json({ error: 'Error al actualizar zona' });
                            } else {
                                res.json({
                                    success: true,
                                    message: 'Zona actualizada exitosamente'
                                });
                            }
                        }
                    );
                }
            });
        });
    });
});

// Eliminar zona
app.delete('/api/zones/:id', requireAuth, (req, res) => {
    const zoneId = req.params.id;
    
    // Verificar que la zona existe
    db.get('SELECT created_by FROM zones WHERE id = ?', [zoneId], (err, zone) => {
        if (err) {
            console.error('Error al verificar zona:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        
        if (!zone) {
            return res.status(404).json({ error: 'Zona no encontrada' });
        }
        
        // Solo el creador o un admin pueden eliminar la zona
        db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
            if (err) {
                console.error('Error al obtener usuario:', err);
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            
            if (zone.created_by !== req.session.userId && user.role !== 'admin') {
                return res.status(403).json({ error: 'No tienes permisos para eliminar esta zona' });
            }
            
            // Eliminar la zona
            db.run('DELETE FROM zones WHERE id = ?', [zoneId], function(err) {
                if (err) {
                    console.error('Error al eliminar zona:', err);
                    res.status(500).json({ error: 'Error al eliminar zona' });
                } else {
                    res.json({
                        success: true,
                        message: 'Zona eliminada exitosamente'
                    });
                }
            });
        });
    });
});

// ========== FIN ENDPOINTS DE ZONAS ==========


// Cerrar base de datos cuando se cierre la aplicación
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Conexión a la base de datos cerrada');
        process.exit(0);
    });
});
