import type { Component } from '../types/index.js';

export const components: Component[] = [
  {
    id: 'esp32',
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
  },
  {
    id: 'uno',
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
  },
  {
    id: 'dht22',
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
  },
  {
    id: 'mpu6050',
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
  },
  {
    id: 'bmp280',
    category: 'sensor',
    name: 'BMP280 Pressure',
    description: '3.3V • I2C/SPI Interface',
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
          { id: 'csb', label: 'CSB', color: 'gray' },
          { id: 'sdo', label: 'SDO', color: 'green' },
        ],
      },
    },
  },
  {
    id: 'l298n',
    category: 'driver',
    name: 'L298N Motor Driver',
    description: '5V-35V • Dual H-Bridge',
    diagram: {
      theme: 'green',
      pins: {
        left: [
          { id: 'in1', label: 'IN1', color: 'blue' },
          { id: 'in2', label: 'IN2', color: 'blue' },
          { id: 'in3', label: 'IN3', color: 'blue' },
          { id: 'in4', label: 'IN4', color: 'blue' },
          { id: 'ena', label: 'ENA', color: 'green' },
          { id: 'enb', label: 'ENB', color: 'green' },
        ],
        right: [
          { id: 'out1', label: 'OUT1', color: 'red' },
          { id: 'out2', label: 'OUT2', color: 'red' },
          { id: 'out3', label: 'OUT3', color: 'red' },
          { id: 'out4', label: 'OUT4', color: 'red' },
          { id: 'vcc', label: 'VCC', color: 'red' },
          { id: 'gnd', label: 'GND', color: 'gray' },
        ],
      },
    },
  },
  {
    id: 'nrf24l01',
    category: 'wireless',
    name: 'nRF24L01+ Radio',
    description: '3.3V • 2.4GHz SPI',
    diagram: {
      theme: 'purple',
      pins: {
        left: [
          { id: 'gnd', label: 'GND', color: 'gray' },
          { id: 'vcc', label: 'VCC', color: 'red' },
          { id: 'ce', label: 'CE', color: 'blue' },
          { id: 'csn', label: 'CSN', color: 'blue' },
        ],
        right: [
          { id: 'sck', label: 'SCK', color: 'green' },
          { id: 'mosi', label: 'MOSI', color: 'purple' },
          { id: 'miso', label: 'MISO', color: 'purple' },
          { id: 'irq', label: 'IRQ', color: 'orange' },
        ],
      },
    },
  },
];
