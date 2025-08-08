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
            });

            this.connection.on('message', (data) => {
                this.handleMessage(JSON.parse(data));
            });

            this.connection.on('close', () => {
                console.log('🔌 Conexión ROS cerrada');
                this.connected = false;
            });

            this.connection.on('error', (error) => {
                console.error('❌ Error de ROS:', error.message);
                this.connected = false;
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
        console.log(`👂 Suscrito a tópico ${topic}`);
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

    // Obtener estado de la conexión
    getStatus() {
        return {
            connected: this.connected,
            rosbridge_url: this.rosbridge_url,
            last_ping: this.lastPing,
            topics_count: this.topics.length,
            active_subscribers: this.subscribers.size
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
