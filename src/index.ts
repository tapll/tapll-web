import { boot } from './boot';

boot(document.currentScript || document.querySelector('script[data-key]'));
