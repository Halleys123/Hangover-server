import type { Project } from '../types/index.js';

export const projects: Project[] = [
  {
    id: '1',
    name: '3D Printer Build',
    description: 'Custom FDM printer with RAMPS 1.4 and TMC2209 drivers',
    components: ['RAMPS 1.4', 'TMC2209', 'NEMA 17'],
    date: '2024-12-15',
    status: 'in-progress',
    canvas: { nodes: [], edges: [] },
  },
  {
    id: '2',
    name: 'Smart Plant Monitor',
    description: 'IoT moisture sensor with ESP32 and capacitive soil sensor',
    components: ['ESP32', 'Capacitive Soil Sensor', 'MCP3008'],
    date: '2024-12-10',
    status: 'completed',
    canvas: { nodes: [], edges: [] },
  },
  {
    id: '3',
    name: 'Weather Station',
    description: 'Arduino-based weather monitoring system',
    components: ['Arduino Uno', 'DHT22', 'BMP280'],
    date: '2024-12-05',
    status: 'in-progress',
    canvas: { nodes: [], edges: [] },
  },
];
