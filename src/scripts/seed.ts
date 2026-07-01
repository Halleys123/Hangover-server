import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Component } from '../models/Component.js';
import { Datasheet } from '../models/Datasheet.js';

const MONGO_URI =
  process.env.MONGODB_URI ?? 'mongodb://localhost:27017/hangover';

const DEMO = {
  email: 'demo@hangover.dev',
  name: 'Demo User',
  password: 'demo1234',
};

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const existing = await User.findOne({ email: DEMO.email });
  if (existing) {
    await Promise.all([
      Project.deleteMany({ userId: existing._id }),
      Component.deleteMany({ userId: existing._id }),
      Datasheet.deleteMany({ userId: existing._id }),
      User.deleteOne({ _id: existing._id }),
    ]);
    console.log('Cleared existing demo data');
  }

  const user = await User.create({
    email: DEMO.email,
    name: DEMO.name,
    password: await bcrypt.hash(DEMO.password, 12),
  });
  console.log(`Created user: ${user.email}`);

  const [ds1, ds2] = await Datasheet.insertMany([
    {
      userId: user._id,
      name: 'ESP32-WROOM-32_Datasheet.pdf',
      size: '1.2 MB',
      filePath: '',
      parsed: true,
      cogneeConfig: {
        voltage: 3.3,
        protocols: ['I2C', 'SPI', 'UART', 'WiFi', 'BLE'],
        maxCurrentMa: 500,
        pinCount: 38,
        operatingTemp: '-40°C to 85°C',
      },
      uploadedAt: new Date('2024-12-14T10:00:00Z'),
    },
    {
      userId: user._id,
      name: 'DHT22_Specifications.pdf',
      size: '450 KB',
      filePath: '',
      parsed: true,
      cogneeConfig: {
        voltage: '3.3–5.0',
        protocols: ['1-Wire'],
        maxCurrentMa: 2.5,
        measurement: { temperature: '-40°C to 80°C', humidity: '0–100% RH' },
        accuracy: { temperature: '±0.5°C', humidity: '±2% RH' },
      },
      uploadedAt: new Date('2024-12-13T15:30:00Z'),
    },
  ]);
  console.log('Created 2 datasheets');

  const [comp1, , comp3] = await Component.insertMany([
    {
      userId: user._id,
      datasheetId: ds1._id,
      category: 'microcontroller',
      name: 'ESP32 DevKit V1',
      description: '3.3V Logic • WiFi/BT',
      diagram: {
        theme: 'blue',
        pins: {
          left: [
            { id: '3v3', label: '3V3', color: 'red' },
            { id: 'en', label: 'EN', color: 'blue' },
            { id: 'vp', label: 'VP', color: 'green' },
            { id: 'vn', label: 'VN', color: 'green' },
            { id: 'd34', label: 'D34', color: 'gray' },
            { id: 'd35', label: 'D35', color: 'gray' },
          ],
          right: [
            { id: 'gnd', label: 'GND', color: 'gray' },
            { id: 'd23', label: 'D23', color: 'blue' },
            { id: 'd22', label: 'D22', color: 'blue' },
            { id: 'tx0', label: 'TX0', color: 'purple' },
            { id: 'rx0', label: 'RX0', color: 'purple' },
            { id: 'd21', label: 'D21', color: 'blue' },
          ],
        },
      },
      cogneeConfig: null,
    },
    {
      userId: user._id,
      datasheetId: null,
      category: 'microcontroller',
      name: 'Arduino Uno R3',
      description: '5V Logic • ATmega328P',
      diagram: {
        theme: 'blue',
        pins: {
          left: [
            { id: '5v', label: '5V', color: 'red' },
            { id: '3v3', label: '3.3V', color: 'red' },
            { id: 'gnd1', label: 'GND', color: 'gray' },
            { id: 'gnd2', label: 'GND', color: 'gray' },
            { id: 'vin', label: 'VIN', color: 'red' },
          ],
          right: [
            { id: 'a0', label: 'A0', color: 'green' },
            { id: 'a1', label: 'A1', color: 'green' },
            { id: 'd0', label: 'D0 (RX)', color: 'purple' },
            { id: 'd1', label: 'D1 (TX)', color: 'purple' },
            { id: 'd2', label: 'D2', color: 'blue' },
          ],
        },
      },
      cogneeConfig: null,
    },
    {
      userId: user._id,
      datasheetId: ds2._id,
      category: 'sensor',
      name: 'DHT22 Temp/Humid',
      description: '3.3V-5V • Digital 1-Wire',
      diagram: {
        theme: 'orange',
        pins: {
          left: [
            { id: 'vcc', label: 'VCC', color: 'red' },
            { id: 'data', label: 'DATA', color: 'blue' },
            { id: 'nc', label: 'NC', color: 'gray' },
            { id: 'gnd', label: 'GND', color: 'gray' },
          ],
          right: [],
        },
      },
      cogneeConfig: null,
    },
    {
      userId: user._id,
      datasheetId: null,
      category: 'sensor',
      name: 'MPU6050 IMU',
      description: '3.3V • I2C Interface',
      diagram: {
        theme: 'orange',
        pins: {
          left: [
            { id: 'vcc', label: 'VCC', color: 'red' },
            { id: 'gnd', label: 'GND', color: 'gray' },
            { id: 'scl', label: 'SCL', color: 'pink' },
            { id: 'sda', label: 'SDA', color: 'pink' },
          ],
          right: [
            { id: 'xda', label: 'XDA', color: 'purple' },
            { id: 'xcl', label: 'XCL', color: 'purple' },
            { id: 'ado', label: 'AD0', color: 'green' },
            { id: 'int', label: 'INT', color: 'blue' },
          ],
        },
      },
      cogneeConfig: null,
    },
  ]);
  console.log('Created 4 personal components');

  await Project.insertMany([
    {
      userId: user._id,
      name: '3D Printer Build',
      description: 'Custom FDM printer with RAMPS 1.4 and TMC2209 drivers',
      components: ['RAMPS 1.4', 'TMC2209', 'NEMA 17'],
      date: '2024-12-15',
      status: 'in-progress',
      canvas: {
        nodes: [
          {
            id: 'node-esp32',
            type: 'hardware',
            position: { x: 120, y: 160 },
            data: { label: comp1.name, diagram: comp1.diagram },
          },
          {
            id: 'node-dht22',
            type: 'hardware',
            position: { x: 480, y: 160 },
            data: { label: comp3.name, diagram: comp3.diagram },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'node-esp32',
            target: 'node-dht22',
            sourceHandle: 'd34',
            targetHandle: 'data',
          },
        ],
      },
    },
    {
      userId: user._id,
      name: 'Smart Plant Monitor',
      description: 'IoT moisture sensor with ESP32 and capacitive soil sensor',
      components: ['ESP32', 'Capacitive Soil Sensor', 'MCP3008'],
      date: '2024-12-10',
      status: 'completed',
      canvas: { nodes: [], edges: [] },
    },
    {
      userId: user._id,
      name: 'Weather Station',
      description: 'Arduino-based weather monitoring system',
      components: ['Arduino Uno', 'DHT22', 'BMP280'],
      date: '2024-12-05',
      status: 'in-progress',
      canvas: { nodes: [], edges: [] },
    },
  ]);
  console.log('Created 3 projects');

  console.log('\nSeed complete!');
  console.log(`  Email:    ${DEMO.email}`);
  console.log(`  Password: ${DEMO.password}`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
