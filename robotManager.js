// Utilidades para gestión del robot TurtleBot
const WebSocket = require('ws');

class RobotManager {
    constructor() {
        this.rosbridge_url = 'ws://turtlebot-NUC.local:9090';
        this.connection = null;
        this.connected = false;
        this.topics = [];
        this.lastPing = null;
        this.subscribers = new Map();
        this.currentMap = null;
        this.amclPose = null;
        this.odomPose = null;
        this.batteryLevel = 100;
        this.lowBatteryNotified = false;
        this.criticalBatteryNotified = false;
        this.emailNotifier = null;
        
        // Intentar cargar el notificador de email
        try {
            this.emailNotifier = require('./emailNotifier');
        } catch (error) {
            console.log('⚠️  EmailNotifier no disponible');
        }
    }

    // Conectar a ROS Bridge
    async connect() {
        try {
            this.connection = new WebSocket(this.rosbridge_url);
            
            this.connection.on('open', () => {
                console.log('✅ Conectado a ROS Bridge');
                this.connected = true;
                this.lastPing = new Date();
                this.getTopics();
                this.setupBatteryMonitoring();
            });

            this.connection.on('message', (data) => {
                this.handleMessage(JSON.parse(data));
            });

            this.connection.on('close', () => {
                console.log('🔌 Conexión ROS cerrada');
                const wasConnected = this.connected;
                this.connected = false;
                
                // Enviar notificación de desconexión
                if (wasConnected && this.emailNotifier) {
                    this.emailNotifier.sendNotification('ROBOT_DISCONNECTED', {
                        lastLocation: 'Sistema'
                    });
                }
            });

            this.connection.on('error', (error) => {
                console.error('❌ Error de ROS:', error.message);
                this.connected = false;
                
                // Enviar notificación de error
                if (this.emailNotifier) {
                    this.emailNotifier.sendNotification('ROBOT_ERROR', {
                        error: 'Error de conexión ROS',
                        details: error.message
                    });
                }
            });

        } catch (error) {
            console.error('Error al conectar con ROS:', error.message);
            this.connected = false;
        }
    }

    // Manejar mensajes de ROS
    handleMessage(message) {
        if (message.op === 'publish') {
            // Mensaje de un tópico
            this.lastPing = new Date();
            
            // Llamar al callback del suscriptor si existe
            if (message.topic && this.subscribers.has(message.topic)) {
                const callback = this.subscribers.get(message.topic);
                if (callback && typeof callback === 'function') {
                    callback(message.msg);
                }
            }
        } else if (message.op === 'set_level') {
            // Respuesta de configuración
            console.log('ROS configuración aplicada');
        } else if (message.op === 'service_response' && message.service === '/rosapi/topics') {
            // Respuesta de la lista de tópicos
            if (message.values && message.values.topics) {
                this.topics = message.values.topics;
                console.log(`📋 ${this.topics.length} tópicos disponibles`);
            }
        }
    }

    // Obtener lista de tópicos disponibles
    getTopics() {
        if (!this.connected || !this.connection) return;

        const getTopicsMsg = {
            op: 'call_service',
            service: '/rosapi/topics',
            args: {}
        };

        this.connection.send(JSON.stringify(getTopicsMsg));
    }

    // Publicar mensaje en un tópico
    publish(topic, messageType, message) {
        if (!this.connected || !this.connection) {
            throw new Error('No hay conexión ROS disponible');
        }

        const publishMsg = {
            op: 'publish',
            topic: topic,
            msg: message
        };

        this.connection.send(JSON.stringify(publishMsg));
        console.log(`📡 Mensaje enviado a ${topic}:`, message);
    }

    // Suscribirse a un tópico
    subscribe(topic, messageType, callback) {
        if (!this.connected || !this.connection) {
            throw new Error('No hay conexión ROS disponible');
        }

        const subscribeMsg = {
            op: 'subscribe',
            topic: topic,
            type: messageType
        };

        this.connection.send(JSON.stringify(subscribeMsg));
        this.subscribers.set(topic, callback);
    }

    // Desuscribirse de un tópico
    unsubscribe(topic) {
        if (!this.connected || !this.connection) return;

        const unsubscribeMsg = {
            op: 'unsubscribe',
            topic: topic
        };

        this.connection.send(JSON.stringify(unsubscribeMsg));
        this.subscribers.delete(topic);
        console.log(`🔇 Desuscrito de tópico ${topic}`);
    }

    // Enviar comando de velocidad al robot (TurtleBot específico)
    sendVelocityCommand(linear_x = 0, angular_z = 0) {
        const velocityMsg = {
            linear: {
                x: linear_x,
                y: 0.0,
                z: 0.0
            },
            angular: {
                x: 0.0,
                y: 0.0,
                z: angular_z
            }
        };

        try {
            // Usar el tópico específico del TurtleBot
            this.publish('/mobile_base/commands/velocity', 'geometry_msgs/Twist', velocityMsg);
            return { success: true, message: 'Comando de velocidad enviado a TurtleBot' };
        } catch (error) {
            // Enviar notificación de error si falla el comando
            if (this.emailNotifier) {
                this.emailNotifier.sendNotification('ROBOT_ERROR', {
                    error: 'Error enviando comando de velocidad',
                    details: error.message
                });
            }
            return { success: false, error: error.message };
        }
    }

    // Parar el robot completamente
    stopRobot() {
        return this.sendVelocityCommand(0, 0);
    }

    // Mover el robot hacia adelante
    moveForward(speed = 0.2) {
        return this.sendVelocityCommand(speed, 0);
    }

    // Mover el robot hacia atrás
    moveBackward(speed = 0.2) {
        return this.sendVelocityCommand(-speed, 0);
    }

    // Girar el robot a la izquierda
    turnLeft(speed = 0.5) {
        return this.sendVelocityCommand(0, speed);
    }

    // Girar el robot a la derecha
    turnRight(speed = 0.5) {
        return this.sendVelocityCommand(0, -speed);
    }

    // Configurar monitoreo de batería
    setupBatteryMonitoring() {
        if (!this.connected || !this.connection) return;
        
        // Suscribirse al tópico de batería del TurtleBot (si está disponible)
        try {
            this.subscribe('/mobile_base/sensors/core', 'kobuki_msgs/SensorState', (msg) => {
                this.handleBatteryData(msg);
            });
        } catch (error) {
            console.log('⚠️  Tópico de batería no disponible, usando simulación');
            // Simulación de batería para pruebas
            this.simulateBatteryLevel();
        }
    }

    // Manejar datos de batería
    handleBatteryData(sensorData) {
        if (sensorData && sensorData.battery !== undefined) {
            // Los datos de batería del Kobuki van de 0-164 aproximadamente
            this.batteryLevel = Math.max(0, Math.min(100, (sensorData.battery / 164) * 100));
            this.checkBatteryLevel();
        }
    }

    // Verificar nivel de batería y enviar notificaciones
    checkBatteryLevel() {
        const level = Math.round(this.batteryLevel);
        
        // Batería crítica (menos del 10%)
        if (level <= 10 && !this.criticalBatteryNotified && this.emailNotifier) {
            this.emailNotifier.sendNotification('BATTERY_CRITICAL', {
                batteryLevel: level,
                location: this.getCurrentLocation()
            });
            this.criticalBatteryNotified = true;
            this.lowBatteryNotified = true; // También marcar low battery como notificado
            
            // Parar el robot por seguridad
            this.stopRobot();
            console.log('🚨 Batería crítica - Robot detenido por seguridad');
        }
        // Batería baja (menos del 20%)
        else if (level <= 20 && !this.lowBatteryNotified && this.emailNotifier) {
            this.emailNotifier.sendNotification('BATTERY_LOW', {
                batteryLevel: level,
                location: this.getCurrentLocation()
            });
            this.lowBatteryNotified = true;
        }
        // Resetear notificaciones si la batería se recupera
        else if (level > 25) {
            this.lowBatteryNotified = false;
            this.criticalBatteryNotified = false;
        }
    }

    // Obtener ubicación actual del robot
    getCurrentLocation() {
        if (this.amclPose) {
            return `X: ${this.amclPose.pose.pose.position.x.toFixed(2)}, Y: ${this.amclPose.pose.pose.position.y.toFixed(2)}`;
        } else if (this.odomPose) {
            return `Odometría X: ${this.odomPose.pose.pose.position.x.toFixed(2)}, Y: ${this.odomPose.pose.pose.position.y.toFixed(2)}`;
        }
        return 'Desconocida';
    }

    // Simulación de batería para pruebas (cuando no hay sensor real)
    simulateBatteryLevel() {
        // Simular descarga gradual de batería para pruebas
        setInterval(() => {
            if (this.connected) {
                this.batteryLevel = Math.max(5, this.batteryLevel - 0.1); // Descarga muy lenta
                this.checkBatteryLevel();
            }
        }, 60000); // Verificar cada minuto
    }

    // Enviar datos de tour al robot
    sendTourData(robotId, tourData) {
        if (!this.connected || !this.connection) {
            throw new Error('No hay conexión ROS disponible');
        }

        try {
            // Publicar datos del tour en un tópico específico
            const tourMessage = {
                robot_id: robotId,
                tour_id: tourData.tour.tour_id,
                tour_name: tourData.tour.name,
                waypoints: tourData.tour.waypoints,
                pin: tourData.pin_string,
                usuario: tourData.usuario,
                timestamp: new Date().toISOString()
            };

            // Usar tópico personalizado para enviar datos de tours
            this.publish('/web_tour_assignment', 'std_msgs/String', {
                data: JSON.stringify(tourMessage)
            });

            console.log(`📡 Datos del tour enviados al robot ${robotId} via ROS`);
            return true;
        } catch (error) {
            console.error('Error al enviar datos del tour:', error);
            return false;
        }
    }

    // Enviar comando de navegación a waypoint específico
    sendNavigationGoal(x, y, z = 0, orientation = { x: 0, y: 0, z: 0, w: 1 }) {
        if (!this.connected || !this.connection) {
            throw new Error('No hay conexión ROS disponible');
        }

        const goalMessage = {
            header: {
                stamp: { sec: Math.floor(Date.now() / 1000), nanosec: 0 },
                frame_id: 'map'
            },
            pose: {
                position: { x: x, y: y, z: z },
                orientation: orientation
            }
        };

        try {
            this.publish('/move_base_simple/goal', 'geometry_msgs/PoseStamped', goalMessage);
            console.log(`🎯 Objetivo de navegación enviado: (${x}, ${y}, ${z})`);
            return true;
        } catch (error) {
            console.error('Error al enviar objetivo de navegación:', error);
            return false;
        }
    }

    // Obtener estado de batería
    getBatteryStatus() {
        return {
            level: Math.round(this.batteryLevel),
            lowBatteryNotified: this.lowBatteryNotified,
            criticalBatteryNotified: this.criticalBatteryNotified
        };
    }

    // Obtener estado de la conexión
    getStatus() {
        return {
            connected: this.connected,
            rosbridge_url: this.rosbridge_url,
            last_ping: this.lastPing,
            topics_count: this.topics.length,
            active_subscribers: this.subscribers.size,
            battery: this.getBatteryStatus(),
            location: this.getCurrentLocation()
        };
    }

    // Cerrar conexión
    disconnect() {
        if (this.connection) {
            this.stopRobot(); // Parar el robot antes de desconectar
            this.connection.close();
            this.connected = false;
            this.subscribers.clear();
            console.log('🔌 Desconectado de ROS Bridge');
        }
    }
}

// Instancia global del manager
const robotManager = new RobotManager();

// Intentar conectar al inicializar
robotManager.connect();

// Reconectar automáticamente cada 30 segundos si se pierde la conexión
setInterval(() => {
    if (!robotManager.connected) {
        console.log('🔄 Intentando reconectar a ROS...');
        robotManager.connect();
    }
}, 30000);

module.exports = robotManager;
