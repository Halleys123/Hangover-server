/**
 * Utility: derivePins
 * Deterministically constructs accurate visual schematic pins (left and right headers)
 * for React Flow and database representation based on extracted Cognee specs or component classification.
 * 
 * Ensures 2-wire power devices (e.g. Peltier TEC modules, DC Fans, Heatsink assemblies) only display (+) RED and (-) BLACK leads,
 * eliminating erroneous random SIG/DATA pins when unpopulated in the datasheet extraction.
 */

export interface SchematicPin {
  id: string;
  label: string;
  color: string;
}

export interface DerivedDiagram {
  theme: string;
  pins: {
    left: SchematicPin[];
    right: SchematicPin[];
  };
}

export function derivePins(name: string, cogneeConfig: Record<string, any> | null): DerivedDiagram {
  const nStr = (name || '').toLowerCase();
  const classStr = ((cogneeConfig && cogneeConfig['Component Classification']) || '').toString().toLowerCase();
  const combined = `${nStr} ${classStr}`;

  const isSensor = combined.includes('sensor') || combined.includes('dht') || combined.includes('mpu') || combined.includes('humidity');
  const theme = isSensor ? 'orange' : 'blue';

  // 1. Check if cogneeConfig.Pins explicitly has populated power/digital/analog arrays
  if (cogneeConfig && cogneeConfig.Pins && typeof cogneeConfig.Pins === 'object') {
    const pinsObj = cogneeConfig.Pins as Record<string, any>;
    const power = Array.isArray(pinsObj.power) ? pinsObj.power : (Array.isArray(pinsObj.pwr) ? pinsObj.pwr : []);
    const ground = Array.isArray(pinsObj.ground) ? pinsObj.ground : (Array.isArray(pinsObj.gnd) ? pinsObj.gnd : []);
    const digital = Array.isArray(pinsObj.digital) ? pinsObj.digital : (Array.isArray(pinsObj.dig) ? pinsObj.dig : []);
    const analog = Array.isArray(pinsObj.analog) ? pinsObj.analog : (Array.isArray(pinsObj.ana) ? pinsObj.ana : []);
    const others = Object.keys(pinsObj)
      .filter(k => !['power', 'pwr', 'ground', 'gnd', 'digital', 'dig', 'analog', 'ana'].includes(k))
      .flatMap(k => Array.isArray(pinsObj[k]) ? pinsObj[k] : []);

    if (power.length > 0 || ground.length > 0 || digital.length > 0 || analog.length > 0 || others.length > 0) {
      const mapPin = (p: any, idx: number, prefix: string, defaultColor: string): SchematicPin & { explicitSide?: string } => {
        const idStr = p.id || `p_${prefix}_${idx}`;
        const nameStr = p.name || idStr;
        const isGnd =
          prefix === 'gnd' ||
          p.type === 'ground' ||
          idStr.toLowerCase().includes('gnd') ||
          idStr.toLowerCase().includes('black') ||
          idStr.toLowerCase().includes('neg') ||
          idStr.toLowerCase().includes('cathode') ||
          nameStr.toLowerCase().includes('gnd') ||
          nameStr.toLowerCase().includes('black') ||
          nameStr.toLowerCase().includes('neg') ||
          nameStr.toLowerCase().includes('cathode');
        let color = defaultColor;
        if (prefix === 'pwr' || prefix === 'gnd') color = isGnd ? 'gray' : 'red';
        else if (prefix === 'ana') color = 'green';
        else if (prefix === 'dig') color = 'blue';
        else color = isGnd ? 'gray' : defaultColor;

        return {
          id: idStr.toLowerCase(),
          label: p.id && p.name && p.id !== p.name ? `${p.id} (${p.name})` : nameStr,
          color,
          explicitSide: p.side ? p.side.toLowerCase() : undefined
        };
      };

      const pwrPins = power.map((p: any, idx: number) => mapPin(p, idx, 'pwr', 'red'));
      const gndPins = ground.map((p: any, idx: number) => mapPin(p, idx, 'gnd', 'gray'));
      const anaPins = analog.map((p: any, idx: number) => mapPin(p, idx, 'ana', 'green'));
      const digPins = digital.map((p: any, idx: number) => mapPin(p, idx, 'dig', 'blue'));
      const othPins = others.map((p: any, idx: number) => mapPin(p, idx, 'oth', 'blue'));

      let left: SchematicPin[] = [];
      let right: SchematicPin[] = [];
      const unassigned: SchematicPin[] = [];

      [...pwrPins, ...gndPins, ...anaPins, ...digPins, ...othPins].forEach(p => {
        if (p.explicitSide === 'left') left.push(p);
        else if (p.explicitSide === 'right') right.push(p);
        else unassigned.push(p);
      });

      // Default functional partitioning: Power rails + Analog inputs on left, Digital I/O + Ground on right
      const defaultLeft = unassigned.filter(p => pwrPins.some(pw => pw.id === p.id) || anaPins.some(an => an.id === p.id));
      const defaultRight = unassigned.filter(p => digPins.some(dg => dg.id === p.id) || gndPins.some(gn => gn.id === p.id) || othPins.some(ot => ot.id === p.id));

      left = [...left, ...defaultLeft];
      right = [...right, ...defaultRight];

      // If severely imbalanced (e.g. 2 left vs 20 right), rebalance to keep box symmetrical and close to square IC outline
      if (Math.abs(left.length - right.length) > 4 && (left.length + right.length) > 6) {
        const allPins = [...left, ...right];
        const half = Math.ceil(allPins.length / 2);
        left = allPins.slice(0, half);
        right = allPins.slice(half);
      }

      return { theme, pins: { left, right } };
    }
  }

  // 2. Derive deterministic accurate pin leads based on component classification & naming rules
  const is2WirePowerDevice =
    combined.includes('tec') ||
    combined.includes('peltier') ||
    combined.includes('thermoelectric') ||
    combined.includes('cooler') ||
    combined.includes('fan') ||
    combined.includes('fhs') ||
    combined.includes('heat sink') ||
    combined.includes('motor') ||
    combined.includes('pump') ||
    combined.includes('lamp') ||
    combined.includes('heater');

  const isPowerSupply =
    combined.includes('pmt') ||
    combined.includes('power supply') ||
    combined.includes('ac/dc') ||
    combined.includes('converter') ||
    combined.includes('adapter');

  if (is2WirePowerDevice) {
    // Exactly 2 leads for Thermoelectric coolers, fans, and cooling assemblies as shown in physical diagrams
    return {
      theme: 'blue',
      pins: {
        left: [
          { id: 'vcc', label: '(+) RED / VCC', color: 'red' },
          { id: 'gnd', label: '(-) BLACK / GND', color: 'gray' },
        ],
        right: [], // Intentionally empty: no random signal or data wires exist on 2-wire cooling hardware
      },
    };
  }

  if (isPowerSupply) {
    return {
      theme: 'blue',
      pins: {
        left: [
          { id: 'ac_in_1', label: 'AC/IN (L/+)', color: 'red' },
          { id: 'ac_in_2', label: 'AC/IN (N/-)', color: 'gray' },
        ],
        right: [
          { id: 'vout_pos', label: 'VOUT (+)', color: 'red' },
          { id: 'vout_neg', label: 'VOUT (-)', color: 'gray' },
        ],
      },
    };
  }

  const isLedOrDiode =
    combined.includes('led') ||
    combined.includes('diode') ||
    combined.includes('optoelectronic') ||
    combined.includes('lamp');

  if (isLedOrDiode) {
    return {
      theme: 'blue',
      pins: {
        left: [
          { id: 'anode', label: '(+) ANODE', color: 'red' },
        ],
        right: [
          { id: 'cathode', label: '(-) CATHODE / GND', color: 'gray' },
        ],
      },
    };
  }

  if (isSensor) {
    return {
      theme: 'orange',
      pins: {
        left: [
          { id: 'vcc', label: 'VCC', color: 'red' },
          { id: 'gnd', label: 'GND', color: 'gray' },
        ],
        right: [
          { id: 'sig', label: 'SIG / DATA', color: 'blue' },
        ],
      },
    };
  }

  // Standard Microcontroller or Generic IC representation
  return {
    theme: 'blue',
    pins: {
      left: [
        { id: 'vcc', label: 'VCC (3.3V/5V)', color: 'red' },
        { id: 'gnd', label: 'GND', color: 'gray' },
      ],
      right: [
        { id: 'gpio0', label: 'I/O / DATA', color: 'blue' },
      ],
    },
  };
}
