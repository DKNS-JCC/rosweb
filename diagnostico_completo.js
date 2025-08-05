#!/usr/bin/env node

/**
 * 🔧 Script de Diagnóstico: Verificar Problemas de Interfaz
 * 
 * Este script verifica todos los tópicos y detecta problemas comunes:
 * - Error de topics.filter
 * - Datos de LIDAR
 * - Mensajes de cámara
 * - Conectividad general
 */

const ROSLIB = require('roslib');

console.log('🔧 Iniciando diagnóstico completo del sistema...\n');

// Conectar a ROS Bridge
const ros = new ROSLIB.Ros({
    url: 'ws://turtlebot-NUC.local:9090'
});

let topicsReceived = false;
let odomReceived = false;
let laserReceived = false;
let diagnosticsReceived = false;
let cameraReceived = false;

ros.on('connection', function() {
    console.log('✅ Conectado a ROS Bridge');
    runDiagnostics();
});

ros.on('error', function(error) {
    console.log('❌ Error de conexión ROS:', error);
    process.exit(1);
});

ros.on('close', function() {
    console.log('🔌 Conexión ROS cerrada');
});

function runDiagnostics() {
    console.log('\n📋 1. Verificando lista de tópicos...');
    
    // Probar getTopics para verificar el error de filter
    ros.getTopics(function(result) {
        topicsReceived = true;
        console.log('📊 Resultado de getTopics:');
        console.log('   Tipo:', typeof result);
        console.log('   Es array:', Array.isArray(result));
        
        if (Array.isArray(result)) {
            console.log(`   ✅ Lista directa de ${result.length} tópicos`);
        } else if (result && Array.isArray(result.topics)) {
            console.log(`   ✅ Objeto con propiedad topics: ${result.topics.length} tópicos`);
        } else {
            console.log('   ❌ Formato inesperado:', Object.keys(result || {}));
        }
        
        // Probar tópicos específicos
        console.log('\n📡 2. Probando tópicos específicos...');
        testSpecificTopics();
        
    }, function(error) {
        console.log('❌ Error obteniendo tópicos:', error);
        testSpecificTopics();
    });
}

function testSpecificTopics() {
    // Test Odometría
    console.log('\n🔄 Probando /odom...');
    const odomTopic = new ROSLIB.Topic({
        ros: ros,
        name: '/odom',
        messageType: 'nav_msgs/Odometry'
    });

    odomTopic.subscribe(function(message) {
        if (!odomReceived) {
            odomReceived = true;
            console.log('✅ /odom funcionando correctamente');
            console.log(`   Posición: X=${message.pose.pose.position.x.toFixed(2)}, Y=${message.pose.pose.position.y.toFixed(2)}`);
        }
    });

    // Test Láser
    console.log('🔄 Probando /laser...');
    const laserTopic = new ROSLIB.Topic({
        ros: ros,
        name: '/laser',
        messageType: 'sensor_msgs/LaserScan'
    });

    laserTopic.subscribe(function(message) {
        if (!laserReceived) {
            laserReceived = true;
            console.log('✅ /laser funcionando correctamente');
            console.log(`   Rangos: ${message.ranges.length} puntos`);
            console.log(`   Rango: ${message.range_min.toFixed(2)}m - ${message.range_max.toFixed(2)}m`);
            
            // Verificar datos válidos
            const validRanges = message.ranges.filter(r => 
                !isNaN(r) && isFinite(r) && r > message.range_min && r < message.range_max
            );
            console.log(`   Datos válidos: ${validRanges.length}/${message.ranges.length}`);
        }
    });

    // Test Diagnósticos
    console.log('🔄 Probando /diagnostics...');
    const diagnosticTopic = new ROSLIB.Topic({
        ros: ros,
        name: '/diagnostics',
        messageType: 'diagnostic_msgs/DiagnosticArray'
    });

    diagnosticTopic.subscribe(function(message) {
        if (!diagnosticsReceived) {
            diagnosticsReceived = true;
            console.log('✅ /diagnostics funcionando correctamente');
            console.log(`   Estados: ${message.status.length}`);
            
            // Buscar batería
            const battery = message.status.find(s => 
                s.name && s.name.includes('Battery') && s.hardware_id === 'Kobuki'
            );
            
            if (battery) {
                console.log('   🔋 Batería Kobuki encontrada');
                const percent = battery.values.find(v => v.key === 'Percent');
                if (percent) {
                    console.log(`   🔋 Nivel: ${percent.value}%`);
                }
            } else {
                console.log('   ⚠️  Batería Kobuki no encontrada');
            }
        }
    });

    // Test Cámara
    console.log('🔄 Probando /camera/color/image_raw...');
    const cameraTopic = new ROSLIB.Topic({
        ros: ros,
        name: '/camera/color/image_raw',
        messageType: 'sensor_msgs/Image'
    });

    cameraTopic.subscribe(function(message) {
        if (!cameraReceived) {
            cameraReceived = true;
            console.log('✅ /camera/color/image_raw funcionando correctamente');
            console.log(`   Resolución: ${message.width}x${message.height}`);
            console.log(`   Encoding: ${message.encoding}`);
            console.log(`   Datos: ${message.data ? message.data.length : 0} bytes`);
        }
    });

    // Timeout y resumen
    setTimeout(() => {
        console.log('\n📊 RESUMEN DEL DIAGNÓSTICO:');
        console.log('==================================');
        console.log(`📋 Lista de tópicos: ${topicsReceived ? '✅' : '❌'}`);
        console.log(`🔄 Odometría (/odom): ${odomReceived ? '✅' : '❌'}`);
        console.log(`📡 Láser (/laser): ${laserReceived ? '✅' : '❌'}`);
        console.log(`🔋 Diagnósticos (/diagnostics): ${diagnosticsReceived ? '✅' : '❌'}`);
        console.log(`📷 Cámara (/camera/color/image_raw): ${cameraReceived ? '✅' : '❌'}`);
        
        const allWorking = topicsReceived && odomReceived && laserReceived && diagnosticsReceived && cameraReceived;
        
        if (allWorking) {
            console.log('\n🎉 ¡TODOS LOS SISTEMAS FUNCIONANDO CORRECTAMENTE!');
            console.log('✅ La interfaz web debería funcionar sin errores');
        } else {
            console.log('\n⚠️  ALGUNOS SISTEMAS NO RESPONDEN');
            console.log('💡 Verifica la conectividad y que el robot esté encendido');
            
            if (!topicsReceived) {
                console.log('🔧 Problema con getTopics - verificar rosbridge');
            }
            if (!odomReceived) {
                console.log('🔧 Problema con odometría - verificar navegación');
            }
            if (!laserReceived) {
                console.log('🔧 Problema con láser - verificar sensor LIDAR');
            }
            if (!diagnosticsReceived) {
                console.log('🔧 Problema con diagnósticos - verificar nodos base');
            }
            if (!cameraReceived) {
                console.log('🔧 Problema con cámara - verificar driver de cámara');
            }
        }
        
        console.log('\n🔌 Cerrando conexión...');
        ros.close();
        process.exit(allWorking ? 0 : 1);
    }, 10000); // Esperar 10 segundos para recoger datos
}
