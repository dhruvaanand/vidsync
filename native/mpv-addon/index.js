const path = require('path');

const releaseDir = path.join(__dirname, 'build', 'Release');

module.exports = require(path.join(releaseDir, 'mpv_addon.node'));
