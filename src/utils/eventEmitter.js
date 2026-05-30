import { EventEmitter } from 'events';

// Cipta satu instance EventEmitter yang boleh dikongsi ke seluruh aplikasi
const eventBus = new EventEmitter();

export default eventBus;