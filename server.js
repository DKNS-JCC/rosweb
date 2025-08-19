
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const robotManager = require('./robotManager');
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
        console.log('✅ Columna name añadida/verificada en tour_waypoints');
        
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

// Panel de administración (ruta oculta)
app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API para obtener todas las rutas (solo admin)
app.get('/api/admin/routes', requireAdmin, (req, res) => {
    db.all('SELECT * FROM tour_routes ORDER BY created_at DESC', (err, routes) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener rutas' });
        }
        res.json(routes);
    });
});

// API para crear nueva ruta (solo admin)
app.post('/api/admin/routes', requireAdmin, (req, res) => {
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
            res.json({ success: true, routeId: this.lastID });
        }
    );
});

// API para eliminar ruta (solo admin)
app.delete('/api/admin/routes/:id', requireAdmin, (req, res) => {
    const routeId = req.params.id;
    
    db.run('DELETE FROM tour_routes WHERE id = ?', [routeId], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Error al eliminar ruta' });
        }
        res.json({ success: true });
    });
});

// API para obtener estadísticas del admin
app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const stats = {};
    
    // Contar usuarios
    db.get('SELECT COUNT(*) as count FROM users', (err, userCount) => {
        if (err) {
            return res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
        
        stats.totalUsers = userCount.count;
        
        // Contar rutas
        db.get('SELECT COUNT(*) as count FROM tour_routes', (err, routeCount) => {
            if (err) {
                return res.status(500).json({ error: 'Error al obtener estadísticas' });
            }
            
            stats.totalRoutes = routeCount.count;
            
            // Contar tours realizados
            db.get('SELECT COUNT(*) as count FROM tour_history', (err, tourCount) => {
                if (err) {
                    return res.status(500).json({ error: 'Error al obtener estadísticas' });
                }
                
                stats.totalToursCompleted = tourCount.count;
                res.json(stats);
            });
        });
    });
});

// API para obtener lista de usuarios
app.get('/api/admin/users', requireAdmin, (req, res) => {
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
app.get('/api/admin/users/:id/tours', requireAdmin, (req, res) => {
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
app.put('/api/admin/users/:id/role', requireAdmin, (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;
    
    if (!['user', 'admin'].includes(role)) {
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
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const userId = req.params.id;
    
    // No permitir eliminar el propio usuario admin
    if (parseInt(userId) === req.session.userId) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
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
            
            res.json({ success: true, message: 'Usuario eliminado exitosamente' });
        });
    });
});

// API para resetear contraseña de usuario
app.put('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
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
    const { tourId } = req.body;
    
    if (!tourId) {
        return res.status(400).json({ error: 'ID de tour requerido' });
    }

    // Verificar que el tour existe y está activo
    db.get('SELECT * FROM tour_routes WHERE id = ? AND is_active = 1', [tourId], (err, tour) => {
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

        // Guardar en historial de tours
        db.run(
            `INSERT INTO tour_history 
             (user_id, tour_route_id, tour_type, tour_name, tour_id, pin) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.session.userId, tourId, tour.name.toLowerCase().replace(/\s+/g, '-'), tour.name, tourInstanceId, PIN],
            function(err) {
                if (err) {
                    console.error('Error al guardar historial de tour:', err);
                    return res.status(500).json({ error: 'Error al iniciar tour' });
                }
                
                res.json({ 
                    success: true, 
                    message: `Tour "${tour.name}" iniciado exitosamente`,
                    tourId: tourInstanceId,
                    tourName: tour.name,
                    tourDescription: tour.description,
                    duration: tour.duration,
                    PIN: PIN,
                    startTime: new Date().toISOString()
                });
            }
        );
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
            feedback
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
            status: tour.completed ? 'Completado' : 'En progreso'
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
    
    // Convertir array a string para comparación
    const pinString = pin.join('');
    
    // Buscar tours activos con este PIN (sin filtrar por usuario específico para el robot)
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
            return res.json({ 
                success: false,
                valido: false,  // Campo para compatibilidad con Python
                message: 'PIN incorrecto o no hay tours activos con este PIN',
                pin_received: pin,
                pin_string: pinString,
                feedback: {
                    type: 'invalid_pin',
                    description: 'El PIN ingresado no corresponde a ningún tour activo'
                }
            });
        }
        
        // PIN válido - obtener waypoints del tour
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
                    valido: false,
                    error: 'Error al obtener información del tour' 
                });
            }
            
            console.log(`🔄 Procesando ${waypoints.length} waypoints con Gemini AI...`);
            
            // Procesar waypoints con Gemini AI para generar descripciones detalladas
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
            
            console.log(`✅ Waypoints procesados con Gemini AI`);
            
            // PIN válido - devolver información completa del tour con waypoints mejorados
            res.json({ 
                success: true,
                valido: true,  // Campo para compatibilidad con Python
                message: 'PIN válido - Tour encontrado',
                pin_received: pin,
                pin_string: pinString,
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
                    type: 'valid_pin',
                    description: `PIN correcto. Tour "${tour.tour_name || tour.tour_name}" encontrado para usuario ${tour.username}`,
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
app.get('/api/admin/tours', requireAdmin, (req, res) => {
    const query = `
        SELECT tr.*, u.username as created_by_name,
               ROUND(AVG(th.rating), 1) as average_rating,
               COUNT(th.rating) as total_ratings,
               COUNT(DISTINCT tw.id) as waypoint_count
        FROM tour_routes tr
        LEFT JOIN users u ON tr.created_by = u.id
        LEFT JOIN tour_history th ON tr.id = th.tour_route_id AND th.rating IS NOT NULL
        LEFT JOIN tour_waypoints tw ON tr.id = tw.tour_route_id
        GROUP BY tr.id, tr.name, tr.description, tr.duration, tr.languages, tr.icon, tr.price, tr.is_active, tr.created_by, tr.created_at, u.username
        ORDER BY tr.created_at DESC
    `;
    
    db.all(query, [], (err, tours) => {
        if (err) {
            console.error('Error al obtener tours:', err);
            return res.status(500).json({ error: 'Error al obtener tours' });
        }
        
        const formattedTours = tours.map(tour => ({
            ...tour,
            status: tour.is_active ? 'active' : 'inactive'
        }));
        
        res.json(formattedTours);
    });
});

// API para obtener un tour específico (admin)
app.get('/api/admin/tours/:id', requireAdmin, (req, res) => {
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
app.post('/api/admin/tours', requireAdmin, (req, res) => {
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
app.put('/api/admin/tours/:id', requireAdmin, (req, res) => {
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
app.delete('/api/admin/tours/:id', requireAdmin, (req, res) => {
    const tourId = req.params.id;
    
    // Verificar si hay tours en progreso o historial
    db.get('SELECT COUNT(*) as count FROM tour_history WHERE tour_route_id = ?', [tourId], (err, result) => {
        if (err) {
            console.error('Error al verificar historial:', err);
            return res.status(500).json({ error: 'Error al verificar historial' });
        }
        
        if (result.count > 0) {
            // Si hay historial, solo desactivar el tour
            db.run('UPDATE tour_routes SET is_active = 0 WHERE id = ?', [tourId], function(err) {
                if (err) {
                    console.error('Error al desactivar tour:', err);
                    return res.status(500).json({ error: 'Error al desactivar tour' });
                }
                
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Tour no encontrado' });
                }
                
                res.json({
                    success: true,
                    message: 'Tour desactivado (no eliminado debido al historial existente)'
                });
            });
        } else {
            // Si no hay historial, eliminar completamente
            db.run('DELETE FROM tour_routes WHERE id = ?', [tourId], function(err) {
                if (err) {
                    console.error('Error al eliminar tour:', err);
                    return res.status(500).json({ error: 'Error al eliminar tour' });
                }
                
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Tour no encontrado' });
                }
                
                res.json({
                    success: true,
                    message: 'Tour eliminado exitosamente'
                });
            });
        }
    });
});

// ===== API ENDPOINTS PARA WAYPOINTS =====

// API para obtener waypoints de un tour
app.get('/api/admin/tours/:id/waypoints', requireAdmin, (req, res) => {
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
app.post('/api/admin/tours/:id/waypoints', requireAdmin, (req, res) => {
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
app.delete('/api/admin/tours/:id/waypoints', requireAdmin, (req, res) => {
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
app.get('/api/admin/tours/:id/reviews', requireAdmin, (req, res) => {
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

// ===== RUTAS DEL ROBOT =====

// Servir la página de control del robot
app.get('/robot', requireAuth, (req, res) => {
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
app.get('/api/admin/robot/commands', requireAuth, requireAdmin, (req, res) => {
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

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

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
