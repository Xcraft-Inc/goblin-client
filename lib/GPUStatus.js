//https://www.electronjs.org/docs/api/structures/gpu-feature-status
const status = {
  red: ['unavailable_off', 'disabled_off'],
  yellow: [
    'unavailable_off_ok',
    'enabled_readback',
    'disabled_off_ok',
    'disabled_software',
  ],
  green: ['enabled_force', 'enabled', 'enabled_on', 'enabled_force_on'],
};

const statusColor = {
  unavailable_off: 'red',
  disabled_off: 'red',
  disabled_software: 'yellow',
  unavailable_off_ok: 'yellow',
  enabled_readback: 'yellow',
  disabled_off_ok: 'yellow',
  enabled_force: 'green',
  enabled: 'green',
  enabled_on: 'green',
  enabled_force_on: 'green',
};

const is = (color) => (value) => status[color].includes(value);
const isYellow = is('yellow');
const isRed = is('red');
const isGreen = is('green');
const isBad = (features) =>
  Object.values(features).every((f) => isYellow(f) || isRed(f));
const isMinimal = (features) =>
  features.gpu_compositing && isGreen(features.gpu_compositing);

const symbol = {red: '🚨', yellow: '🚧', green: '⭐'};
const weight = {red: 1, yellow: 0, green: -1};
const getReport = (features) =>
  Object.entries(features)
    .map(([f, v]) => [f, {color: statusColor[v], value: v}])
    .map(([f, v]) => {
      return [
        weight[v.color],
        `${symbol[v.color]} ${f} (${v.value}/${v.color})`,
      ];
    })
    .sort((a, b) => a[0] - b[0])
    .map((r) => r[1])
    .join('\n  ');

module.exports = {isBad, isMinimal, getReport};
