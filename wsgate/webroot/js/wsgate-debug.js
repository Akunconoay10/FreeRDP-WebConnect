var wsgate = wsgate || {}

wsgate.hasconsole = (typeof console !== 'undefined' && 'debug' in console && 'info' in console && 'warn' in console && 'error' in console);

wsgate.log = {
    drop: function() {
    },
    debug: function() {/* DEBUG */
        if (wsgate.hasconsole) {
            try { console.debug.apply(this, arguments); } catch (error) { }
        }
        /* /DEBUG */},
    info: function() {/* DEBUG */
        if (wsgate.hasconsole) {
            try { console.info.apply(this, arguments); } catch (error) { }
        }
        /* /DEBUG */},
    warn: function() {/* DEBUG */
        if (wsgate.hasconsole) {
            try { console.warn.apply(this, arguments); } catch (error) { }
        }
        /* /DEBUG */},
    err: function() {/* DEBUG */
        if (wsgate.hasconsole) {
            try { console.error.apply(this, arguments); } catch (error) { }
        }
        /* /DEBUG */}
}

wsgate.WSrunner = new Class( {
    Implements: Events,
    initialize: function(url) {
        this.url = url;
    },
    Run: function() {
        try {
            this.sock = new WebSocket(this.url);
        } catch (err) { }
        this.sock.binaryType = 'arraybuffer';
        this.sock.onopen = this.onWSopen.bind(this);
        this.sock.onclose = this.onWSclose.bind(this);
        this.sock.onmessage = this.onWSmsg.bind(this);
        this.sock.onerror = this.onWSerr.bind(this);
    }
});

wsgate.RDP = new Class( {
    Extends: wsgate.WSrunner,
    initialize: function(url, canvas) {
        this.parent(url);
        this.canvas = canvas;
        this.cctx = canvas.getContext('2d');
        this.ccnt = 0;
        this.mq = new Array();
        this.pID = null;
        this.pMTX = 0;
        this.clx = 0;
        this.cly = 0;
        this.clw = 0;
        this.clh = 0;
        this.modkeys = [16, 17, 18, 20, 144, 145];
    },
    Disconnect: function() {
        this._reset();
    },
    /**
     * Create (or retrieve the current instance of) a "backing store" canvas
     * of the same size like th primary canvas. This canvas is NOT linked into
     * the DOM and therefore invisble.
     */
    _bctx: function() {
        if (!this.bctx) {
            this.bstore = new Element('canvas', {
                'width':this.canvas.width,
                'height':this.canvas.height,
            });
            this.bctx = this.bstore.getContext('2d');
        }
        return this.bctx;
    },
    /**
     * Check, if a given point is inside the clipping region.
     */
    _ckclp: function(x, y) {
        if (this.clw || this.clh) {
            return (
                    (x >= this.clx) &&
                    (x <= (this.clx + this.clw)) &&
                    (y >= this.cly) &&
                    (y <= (this.cly + this.clh))
                   );
        }
        // No clipping region
        return true;
    },
    /**
     * Main message loop.
     */
    _pmsg: function() { // process a binary RDP message from our queue
        var op, hdr, data, bmdata, rgba, compressed;
        if (this.pMTX++ > 0) {
            this.pMTX -= 1;
            return;
        }
        while (data = this.mq.shift()) {
            op = new Uint32Array(data, 0, 1);
            switch (op[0]) {
                case 0:
                    // BeginPaint
                    // wsgate.log.debug('BeginPaint');
                    this._ctxS();
                    break;
                case 1:
                    // EndPaint
                    // wsgate.log.debug('EndPaint');
                    this._ctxR();
                    break;
                case 2:
                    /// Single bitmap
                    //
                    //  0 uint32 Destination X
                    //  1 uint32 Destination Y
                    //  2 uint32 Width
                    //  3 uint32 Height
                    //  4 uint32 Bits per Pixel
                    //  5 uint32 Flag: Compressed
                    //  6 uint32 DataSize
                    //
                    hdr = new Uint32Array(data, 4, 7);
                    bmdata = new Uint8Array(data, 32);
                    compressed =  (hdr[5] != 0);
                    // wsgate.log.debug('Bitmap:', (compressed ? ' C ' : ' U '), ' x: ', hdr[0], ' y: ', hdr[1], ' w: ', hdr[2], ' h: ', hdr[3], ' bpp: ', hdr[4]);
                    if ((hdr[4] == 16) || (hdr[4] == 15)) {
                        if (this._ckclp(hdr[0], hdr[1]) &&
                                this._ckclp(hdr[0] + hdr[2], hdr[1] + hdr[3]))
                        {
                            // Completely inside clip region
                            var outB = this.cctx.createImageData(hdr[2], hdr[3]);
                            if (compressed) {
                                wsgate.dRLE16_RGBA(bmdata, hdr[6], hdr[2], outB.data);
                                wsgate.flipV(outB.data, hdr[2], hdr[3]);
                            } else {
                                wsgate.dRGB162RGBA(bmdata, hdr[6], outB.data);
                            }
                            this.cctx.putImageData(outB, hdr[0], hdr[1]);
                        } else {
                            // putImageData ignores the clipping region, so we must
                            // clip ourselves: We first paint into a second canvas,
                            // the use drawImage (which honors clipping).

                            var outB = this._bctx().createImageData(hdr[2], hdr[3]);
                            if (compressed) {
                                // var tmp = new Uint8Array(hdr[2] * hdr[3] * 2);
                                // wsgate.dRLE16(bmdata, hdr[6], hdr[2], tmp);
                                // wsgate.dRGB162RGBA(tmp, hdr[6], outB.data);
                                wsgate.dRLE16_RGBA(bmdata, hdr[6], hdr[2], outB.data);
                                wsgate.flipV(outB.data, hdr[2], hdr[3]);
                            } else {
                                wsgate.dRGB162RGBA(bmdata, hdr[6], outB.data);
                            }
                            this.bctx.putImageData(outB, 0, 0);
                            this.cctx.drawImage(this.bstore, 0, 0, hdr[2], hdr[3],
                                    hdr[0], hdr[1], hdr[2], hdr[3]);
                        }
                    } else {
                        wsgate.log.warn('BPP <> 15/16 not yet implemented');
                    }
                    break;
                case 3:
                    // Primary: OPAQUE_RECT_ORDER
                    // x, y , w, h, color
                    hdr = new Int32Array(data, 4, 4);
                    rgba = new Uint8Array(data, 20, 4);
                    // wsgate.log.debug('Fill:',hdr[0], hdr[1], hdr[2], hdr[3], this._c2s(rgba));
                    this.cctx.fillStyle = this._c2s(rgba);
                    this.cctx.fillRect(hdr[0], hdr[1], hdr[2], hdr[3]);
                    break;
                case 4:
                    // SetBounds
                    // left, top, right, bottom
                    hdr = new Int32Array(data, 4, 4);
                    // All zero means: reset to full canvas size
                    this.clx = hdr[0];
                    this.cly = hdr[1];
                    this.clw = hdr[2] - hdr[0];
                    this.clh = hdr[3] - hdr[1];
                    if (hdr[0] == hdr[1] == hdr[2] == hdr[3] == 0) {
                        hdr[2] = this.canvas.width;
                        hdr[3] = this.canvas.height;
                    }
                    // Replace clipping region, NO intersection.
                    this.cctx.beginPath();
                    this.cctx.rect(0, 0, this.canvas.width, this.canvas.height);
                    this.cctx.clip();
                    // New clipping region
                    this.cctx.beginPath();
                    this.cctx.rect(hdr[0], hdr[1], hdr[2] - hdr[0], hdr[3] - hdr[1]);
                    this.cctx.clip();
                    break; 
                case 5:
                    // PatBlt
                    if (28 == data.byteLength) {
                        // Solid brush style
                        // x, y, width, height, fgcolor, rop3
                        hdr = new Int32Array(data, 4, 4);
                        rgba = new Uint8Array(data, 20, 4);
                        this._sROP(new Uint32Array(data, 24, 1)[0]);
                    }
                    break; 
                default:
                    wsgate.log.warn('Unknown BINRESP: ', data.byteLength);
            }
        }
        this.pMTX -= 1;
    },
    _sROP: function(rop) {
        switch (rop) {
            case 0x00CC0020:
                // GDI_SRCCOPY: D = S
                break;
            case 0x00EE0086:
                // GDI_SRCPAINT: D = S | D
                break;
            case 0x008800C6:
                // GDI_SRCAND: D = S & D
                break;
            case 0x00660046:
                // GDI_SRCINVERT: D = S ^ D
                break;
            case 0x00440328:
                // GDI_SRCERASE: D = S & ~D
                break;
            case 0x00330008:
                // GDI_NOTSRCCOPY: D = ~S
                break;
            case 0x001100A6:
                // GDI_NOTSRCERASE: D = ~S & ~D
                break;
            case 0x00C000CA:
                // GDI_MERGECOPY: D = S & P
                break;
            case 0x00BB0226:
                // GDI_MERGEPAINT: D = ~S | D
                break;
            case 0x00F00021:
                // GDI_PATCOPY: D = P
                break;
            case 0x00FB0A09:
                // GDI_PATPAINT: D = D | (P | ~S)
                break;
            case 0x005A0049:
                // GDI_PATINVERT: D = P ^ D
                break;
            case 0x00550009:
                // GDI_DSTINVERT: D = ~D
                break;
            case 0x00000042:
                // GDI_BLACKNESS: D = 0
                break;
            case 0x00FF0062:
                // GDI_WHITENESS: D = 1
                break;
            case 0x00E20746:
                // GDI_DSPDxax: D = (S & P) | (~S & D)
                break;
            case 0x00B8074A:
                // GDI_PSDPxax: D = (S & D) | (~S & P)
                break;
            case 0x000C0324:
                // GDI_SPna: D = S & ~P
                break;
            case 0x00220326:
                // GDI_DSna D = D & ~S
                break;
            case 0x00220326:
                // GDI_DSna: D = D & ~S
                break;
            case 0x00A000C9:
                // GDI_DPa: D = D & P
                break;
            case 0x00A50065:
                // GDI_PDxn: D = D ^ ~P
                break;
        }
    },
    /**
     * Reset our state to disconnected
     */
    _reset: function() {
        this.pID && clearTimeout(this.pID);
        this.pID = null;
        this.mMTX = 0;
        this.mq.empty();
        if (this.sock.readyState == this.sock.OPEN) {
            this.fireEvent('disconnected');
            this.sock.close();
        }
        this.clx = 0;
        this.cly = 0;
        this.clw = 0;
        this.clh = 0;
        this.canvas.removeEvents();
        this.bctx = null;
        if (this.bstore) {
            this.bstore.destroy();
        }
        while (this.ccnt > 0) {
            this.cctx.restore();
            this.ccnt -= 1;
        }
        this.cctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        document.title = document.title.replace(/:.*/, ': offline');
    },
    /**
     * Event handler for mouse move events
     */
    onMouseMove: function(evt) {
        var buf, a, x, y;
        evt.preventDefault();
        x = evt.client.x - evt.target.offsetLeft;
        y = evt.client.y - evt.target.offsetTop;
        // wsgate.log.debug('mM x: ', x, ' y: ', y);
        if (this.sock.readyState == this.sock.OPEN) {
            buf = new ArrayBuffer(16);
            a = new Uint32Array(buf);
            a[0] = 0; // WSOP_CS_MOUSE
            a[1] = 0x0800; // PTR_FLAGS_MOVE
            a[2] = x;
            a[3] = y;
            this.sock.send(buf);
        }
    },
    /**
     * Event handler for mouse down events
     */
    onMouseDown: function(evt) {
        var buf, a, x, y, which;
        evt.preventDefault();
        x = evt.client.x - evt.target.offsetLeft;
        y = evt.client.y - evt.target.offsetTop;
        which = this._mB(evt);
        // wsgate.log.debug('mD b: ', which, ' x: ', x, ' y: ', y);
        if (this.sock.readyState == this.sock.OPEN) {
            buf = new ArrayBuffer(16);
            a = new Uint32Array(buf);
            a[0] = 0; // WSOP_CS_MOUSE
            a[1] = 0x8000 | which;
            a[2] = x;
            a[3] = y;
            this.sock.send(buf);
        }
    },
    /**
     * Event handler for mouse up events
     */
    onMouseUp: function(evt) {
        var buf, a, x, y, which;
        evt.preventDefault();
        x = evt.client.x - evt.target.offsetLeft;
        y = evt.client.y - evt.target.offsetTop;
        which = this._mB(evt);
        // wsgate.log.debug('mU b: ', which, ' x: ', x, ' y: ', y);
        if (this.sock.readyState == this.sock.OPEN) {
            buf = new ArrayBuffer(16);
            a = new Uint32Array(buf);
            a[0] = 0; // WSOP_CS_MOUSE
            a[1] = which;
            a[2] = x;
            a[3] = y;
            this.sock.send(buf);
        }
    },
    /**
     * Event handler for mouse wheel events
     */
    onMouseWheel: function(evt) {
        var buf, a, x, y;
        evt.preventDefault();
        x = evt.client.x - evt.target.offsetLeft;
        y = evt.client.y - evt.target.offsetTop;
        // wsgate.log.debug('mW d: ', evt.wheel, ' x: ', x, ' y: ', y);
        if (this.sock.readyState == this.sock.OPEN) {
            buf = new ArrayBuffer(16);
            a = new Uint32Array(buf);
            a[0] = 0; // WSOP_CS_MOUSE
            a[1] = 0x200 | ((evt.wheel > 0) ? 0x087 : 0x188);
            a[2] = 0;
            a[3] = 0;
            this.sock.send(buf);
        }
    },
    /**
     * Event handler for key down events
     */
    onKdown: function(evt) {
        var a, buf;
        if (this.modkeys.contains(evt.code)) {
            evt.preventDefault();
            // wsgate.log.debug('kD code: ', evt.code, ' ', evt);
            if (this.sock.readyState == this.sock.OPEN) {
                buf = new ArrayBuffer(12);
                a = new Uint32Array(buf);
                a[0] = 1; // WSOP_CS_KUPDOWN
                a[1] = 1; // down
                a[2] = evt.code;
                this.sock.send(buf);
            }
        }
    },
    /**
     * Event handler for key up events
     */
    onKup: function(evt) {
        var a, buf;
        if (this.modkeys.contains(evt.code)) {
            evt.preventDefault();
            // wsgate.log.debug('kU code: ', evt.code);
            if (this.sock.readyState == this.sock.OPEN) {
                buf = new ArrayBuffer(12);
                a = new Uint32Array(buf);
                a[0] = 1; // WSOP_CS_KUPDOWN
                a[1] = 0; // up
                a[2] = evt.code;
                this.sock.send(buf);
            }
        }
    },
    /**
     * Event handler for key pressed events
     */
    onKpress: function(evt) {
        var a, buf;
        evt.preventDefault();
        if (this.modkeys.contains(evt.code)) {
            return;
        }
        if (this.sock.readyState == this.sock.OPEN) {
            // wsgate.log.debug('kP code: ', evt.code);
            buf = new ArrayBuffer(12);
            a = new Uint32Array(buf);
            a[0] = 2; // WSOP_CS_KPRESS
            a[1] = (evt.shift ? 1 : 0)|(evt.control ? 2 : 0)|(evt.alt ? 4 : 0)|(evt.meta ? 8 : 0);
            a[2] = evt.code;
            this.sock.send(buf);
        }
    },
    /**
     * Event handler for WebSocket RX events
     */
    onWSmsg: function(evt) {
        switch (typeof(evt.data)) {
            // We use text messages for alerts and debugging ...
            case 'string':
                // wsgate.log.debug(evt.data);
                switch (evt.data.substr(0,2)) {
                    case "T:":
                            this._reset();
                            break;
                    case "E:":
                            wsgate.log.err(evt.data.substring(2));
                            this.fireEvent('alert', evt.data.substring(2));
                            this._reset();
                            break;
                    case 'I:':
                            wsgate.log.info(evt.data.substring(2));
                            break;
                    case 'W:':
                            wsgate.log.warn(evt.data.substring(2));
                            break;
                    case 'D:':
                            wsgate.log.debug(evt.data.substring(2));
                            break;
                }
                break;
            // ... and binary messages for the actual RDP stuff.
            case 'object':
                this.mq.push(evt.data);
                break;
        }

    },
    /**
     * Event handler for WebSocket connect events
     */
    onWSopen: function(evt) {
        // Start our message loop
        this.pID = this._pmsg.periodical(10, this);
        // Add listeners for the various input events
        this.canvas.addEvent('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEvent('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEvent('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEvent('mousewheel', this.onMouseWheel.bind(this));
        // Disable the browser's context menu
        this.canvas.addEvent('contextmenu', function(e) {e.stop();});
        // The keyboard events need to be attached to the
        // document, because otherwise we seem to loose them.
        document.addEvent('keydown', this.onKdown.bind(this));
        document.addEvent('keyup', this.onKup.bind(this));
        document.addEvent('keypress', this.onKpress.bind(this));
        this.fireEvent('connected');
    },
    /**
     * Event handler for WebSocket disconnect events
     */
    onWSclose: function(evt) {
        this._reset();
        this.fireEvent('disconnected');
    },
    /**
     * Event handler for WebSocket error events
     */
    onWSerr: function (evt) {
        switch (this.sock.readyState) {
            case this.sock.CONNECTING:
                this.fireEvent('alert', 'Could not connect to WebSockets gateway');
                break;
        }
        this._reset();
    },
    /**
     * Convert a color value containet in an uint8 array into an rgba expression
     * that can be used to parameterize the canvas.
     */
    _c2s: function(c) {
        return 'rgba' + '(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + ((0.0 + c[3]) / 255) + ')';
    },
    /**
     * Save the canvas state and remember this in our object.
     */
    _ctxS: function() {
        this.cctx.save();
        this.ccnt += 1;
    },
    /**
     * Restore the canvas state and remember this in our object.
     */
    _ctxR: function() {
        this.cctx.restore();
        this.ccnt -= 1;
    },
    /**
     * Convert the button information of a mouse event into
     * RDP-like flags.
     */
    _mB: function(evt) {
        var bidx;
        if ('event' in evt && 'button' in evt.event) {
            bidx = evt.event.button;
        } else {
            bidx = evt.rightClick ? 2 : 0;
        }
        switch (bidx) {
            case 0:
                return 0x1000;
            case 1:
                return 0x4000;
            case 2:
                return 0x2000;
        }
        return 0x1000;
    }
});
/* DEBUG */
wsgate.EchoTest = new Class( {
    Extends: wsgate.WSrunner,
    onWSmsg: function(evt) {
        wsgate.log.info('RESPONSE: ', evt.data);
        this.sock.close();
    },
    onWSopen: function(evt) {
        wsgate.log.debug("CONNECTED");
        this.send("WebSocket rocks");
    },
    onWSclose: function(evt) {
        wsgate.log.debug("DISCONNECTED");
    },
    onWSerr: function (evt) {
        wsgate.log.warn(evt);
    },
    send: function(msg) {
        wsgate.log.info("SENT: ", msg); 
        this.sock.send(msg);
    }
});

wsgate.SpeedTest = new Class( {
    Extends: wsgate.WSrunner,
    initialize: function(url, blobsize, iterations) {
        this.parent(url);
        this.blobsize = blobsize;
        this.maxiter = iterations;
        this.count = this.maxiter;
        this.start = undefined;
        this.total = 0;
        this.bb = new BlobBuilder();
        this.ab = new ArrayBuffer(blobsize);
    },
    onWSmsg: function(evt) {
        var time = Date.now() - this.start;
        wsgate.log.debug('Data size: ', evt.data.size, ', roundtrip time: ', time, 'ms');
        this.total += time;
        if (--this.count) {
            this.doChunk();
        } else {
            var ave = this.total / this.maxiter;
            wsgate.log.info('Transfer ratio: ',
                (this.blobsize / ave * 2000).toFixed(1), ' [Bytes per Second] = ',
                (this.blobsize / ave * 0.0152587890625).toFixed(1), ' [Mbps]');
            this.sock.close();
        }

    },
    onWSopen: function(evt) {
        wsgate.log.debug("CONNECTED");
        this.start = undefined;
        this.total = 0;
        this.count = this.maxiter;
        this.doChunk();
    },
    onWSclose: function(evt) {
        wsgate.log.debug("DISCONNECTED");
    },
    onWSerr: function (evt) {
        wsgate.log.warn(evt);
    },
    doChunk: function() {
        this.start = Date.now();
        // FF appears to empty the Blob, while RIM does not.
        if (0 == this.bb.getBlob().size) {
            this.bb.append(this.ab);
        }
        this.sock.send(this.bb.getBlob());
    }
});
/* /DEBUG */

wsgate.copy16 = function(inA, inI, outA, outI) {
    outA[outI++] = inA[inI++];
    outA[outI] = inA[inI];
}
wsgate.xorbuf16 = function(inA, inI, outA, outI, pel) {
    var newPEL = (inA[inI] | (inA[inI + 1] << 8)) ^ pel;
    outA[outI++] = newPEL & 0xFF;
    outA[outI] = (newPEL >> 8) & 0xFF;
}
wsgate.pel16 = function (pel, outA, outI) {
    outA[outI++] = pel & 0xFF;
    outA[outI] = (pel >> 8) & 0xFF;
}

wsgate.copyRGBA = function(inA, inI, outA, outI) {
    if ('subarray' in inA) {
        outA.set(inA.subarray(inI, inI + 4), outI);
    } else {
        outA[outI++] = inA[inI++];
        outA[outI++] = inA[inI++];
        outA[outI++] = inA[inI++];
        outA[outI] = inA[inI];
    }
}
wsgate.xorbufRGBAPel16 = function(inA, inI, outA, outI, pel) {
    var pelR = (pel & 0xF800) >> 11;
    var pelG = (pel & 0x7E0) >> 5;
    var pelB = pel & 0x1F;
    // 656 -> 888
    pelR = (pelR << 3 & ~0x7) | (pelR >> 2);
    pelG = (pelG << 2 & ~0x3) | (pelG >> 4);
    pelB = (pelB << 3 & ~0x7) | (pelB >> 2);

    outA[outI++] = inA[inI] ^ pelR;
    outA[outI++] = inA[inI] ^ pelG;
    outA[outI++] = inA[inI] ^ pelB;
    outA[outI] = 255;                                 // alpha
}
wsgate.buf2RGBA = function(inA, inI, outA, outI) {
    var pel = inA[inI] | (inA[inI + 1] << 8);
    var pelR = (pel & 0xF800) >> 11;
    var pelG = (pel & 0x7E0) >> 5;
    var pelB = pel & 0x1F;
    // 656 -> 888
    pelR = (pelR << 3 & ~0x7) | (pelR >> 2);
    pelG = (pelG << 2 & ~0x3) | (pelG >> 4);
    pelB = (pelB << 3 & ~0x7) | (pelB >> 2);

    outA[outI++] = pelR;
    outA[outI++] = pelG;
    outA[outI++] = pelB;
    outA[outI] = 255;                    // alpha
}
wsgate.pel2RGBA = function (pel, outA, outI) {
    var pelR = (pel & 0xF800) >> 11;
    var pelG = (pel & 0x7E0) >> 5;
    var pelB = pel & 0x1F;
    // 656 -> 888
    pelR = (pelR << 3 & ~0x7) | (pelR >> 2);
    pelG = (pelG << 2 & ~0x3) | (pelG >> 4);
    pelB = (pelB << 3 & ~0x7) | (pelB >> 2);

    outA[outI++] = pelR;
    outA[outI++] = pelG;
    outA[outI++] = pelB;
    outA[outI] = 255;                    // alpha
}

wsgate.flipV = function(inA, width, height) {
    var sll = width * 4;
    var half = height / 2;
    var lbot = sll * (height - 1);
    var ltop = 0;
    var tmp = new Uint8Array(sll);
    var i, j;
    if ('subarray' in inA) {
        for (i = 0; i < half ; ++i) {
            tmp.set(inA.subarray(ltop, ltop + sll));
            inA.set(inA.subarray(lbot, lbot + sll), ltop);
            inA.set(tmp, lbot);
            ltop += sll;
            lbot -= sll;
        }
    } else {
        for (i = 0; i < half ; ++i) {
            for (j = 0; j < sll; ++j) {
                tmp[j] = inA[ltop + j];
                inA[ltop + j] = inA[lbot + j];
                inA[lbot + j] = tmp[j];
            }
            ltop += sll;
            lbot -= sll;
        }
    }
}

wsgate.dRGB162RGBA = function(inA, inLength, outA) {
    var inI = 0;
    var outI = 0;
    while (inI < inLength) {
        wsgate.buf2RGBA(inA, inI, outA, outI);
        inI += 2;
        outI += 4;
    }
}

wsgate.ExtractCodeId = function(bOrderHdr) {
    var code;
    switch (bOrderHdr) {
        case 0xF0:
        case 0xF1:
        case 0xF6:
        case 0xF8:
        case 0xF3:
        case 0xF2:
        case 0xF7:
        case 0xF4:
        case 0xF9:
        case 0xFA:
        case 0xFD:
        case 0xFE:
            return bOrderHdr;
    }
    code = bOrderHdr >> 5;
    switch (code) {
        case 0x00:
        case 0x01:
        case 0x03:
        case 0x02:
        case 0x04:
            return code;
    }
    return bOrderHdr >> 4;
}
wsgate.ExtractRunLength = function(code, inA, inI, advance) {
    var runLength = 0;
    var ladvance = 1;
    switch (code) {
        case 0x02:
            runLength = inA[inI] & 0x1F;
            if (0 == runLength) {
                runLength = inA[inI + 1] + 1;
                ladvance += 1;
            } else {
                runLength *= 8;
            }
            break;
        case 0x0D:
            runLength = inA[inI] & 0x0F;
            if (0 == runLength) {
                runLength = inA[inI + 1] + 1;
                ladvance += 1;
            } else {
                runLength *= 8;
            }
            break;
        case 0x00:
        case 0x01:
        case 0x03:
        case 0x04:
            runLength = inA[inI] & 0x1F;
            if (0 == runLength) {
                runLength = inA[inI + 1] + 32;
                ladvance += 1;
            }
            break;
        case 0x0C:
        case 0x0E:
            runLength = inA[inI] & 0x0F;
            if (0 == runLength) {
                runLength = inA[inI + 1] + 16;
                ladvance += 1;
            }
            break;
        case 0xF0:
        case 0xF1:
        case 0xF6:
        case 0xF8:
        case 0xF3:
        case 0xF2:
        case 0xF7:
        case 0xF4:
            runLength = inA[inI + 1] | (inA[inI + 2] << 8);
            ladvance += 2;
            break;
    }
    advance.val = ladvance;
    return runLength;
}

wsgate.WriteFgBgImage16toRGBA = function(outA, outI, rowDelta, bitmask, fgPel, cBits) {
    var cmpMask = 0x01;

    while (cBits-- > 0) {
        if (bitmask & cmpMask) {
            wsgate.xorbufRGBAPel16(outA, outI - rowDelta, outA, outI, fgPel);
        } else {
            wsgate.copyRGBA(outA, outI - rowDelta, outA, outI);
        }
        outI += 4;
        cmpMask <<= 1;
    }
    return outI;
}

wsgate.WriteFirstLineFgBgImage16toRGBA = function(outA, outI, bitmask, fgPel, cBits) {
    var cmpMask = 0x01;

    while (cBits-- > 0) {
        if (bitmask & cmpMask) {
            wsgate.pel2RGBA(fgPel, outA, outI);
        } else {
            wsgate.pel2RGBA(0, outA, outI);
        }
        outI += 4;
        cmpMask <<= 1;
    }
    return outI;
}

wsgate.WriteFgBgImage16to16 = function(outA, outI, rowDelta, bitmask, fgPel, cBits) {
    var cmpMask = 0x01;

    while (cBits-- > 0) {
        if (bitmask & cmpMask) {
            wsgate.xorbuf16(outA, outI - rowDelta, outA, outI, fgPel);
        } else {
            wsgate.copy16(outA, outI - rowDelta, outA, outI);
        }
        outI += 2;
        cmpMask <<= 1;
    }
    return outI;
}

wsgate.WriteFirstLineFgBgImage16to16 = function(outA, outI, bitmask, fgPel, cBits) {
    var cmpMask = 0x01;

    while (cBits-- > 0) {
        if (bitmask & cmpMask) {
            wsgate.pel16(fgPel, outA, outI);
        } else {
            wsgate.pel16(0, outA, outI);
        }
        outI += 2;
        cmpMask <<= 1;
    }
    return outI;
}

wsgate.dRLE16 = function(inA, inLength, width, outA) {
    var runLength;
    var code, pixelA, pixelB, bitmask;
    var inI = 0;
    var outI = 0;
    var fInsertFgPel = false;
    var fFirstLine = true;
    var fgPel = 0xFFFFFF;
    var rowDelta = width * 2;
    var advance = {val: 0};

    while (inI < inLength) {
        if (fFirstLine) {
            if (outI >= rowDelta) {
                fFirstLine = false;
                fInsertFgPel = false;
            }
        }
        code = wsgate.ExtractCodeId(inA[inI]);
        if (code == 0x00 || code == 0xF0) {
            runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
            inI += advance.val;
            if (fFirstLine) {
                if (fInsertFgPel) {
                    wsgate.pel16(fgPel, outA, outI);
                    outI += 2;
                    runLength -= 1;
                }
                while (runLength-- > 0) {
                    wsgate.pel16(0, outA, outI);
                    outI += 2;
                }
            } else {
                if (fInsertFgPel) {
                    wsgate.xorbuf16(outA, outI - rowDelta, outA, outI, fgPel);
                    outI += 2;
                    runLength -= 1;
                }
                while (runLength-- > 0) {
                    wsgate.copy16(outA, outI - rowDelta, outA, outI);
                    outI += 2;
                }
            }
            fInsertFgPel = true;
            continue;
        }
        fInsertFgPel = false;
        switch (code) {
            case 0x01:
            case 0xF1:
            case 0x0C:
            case 0xF6:
                runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
                inI += advance.val;
                if (code == 0x0C || code == 0xF6) {
                    fgPel = inA[inI] | (inA[inI + 1] << 8);
                    inI += 2;
                }
                if (fFirstLine) {
                    while (runLength-- > 0) {
                        wsgate.pel16(fgPel, outA, outI);
                        outI += 2;
                    }
                } else {
                    while (runLength-- > 0) {
                        wsgate.xorbuf16(outA, outI - rowDelta, outA, outI, fgPel);
                        outI += 2;
                    }
                }
                break;
            case 0x0E:
            case 0xF8:
                runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
                inI += advance.val;
                pixelA = inA[inI] | (inA[inI + 1] << 8);
                inI += 2;
                pixelB = inA[inI] | (inA[inI + 1] << 8);
                inI += 2;
                while (runLength-- > 0) {
                    wsgate.pel16(pixelA, outA, outI);
                    outI += 2;
                    wsgate.pel16(pixelB, outA, outI);
                    outI += 2;
                }
                break;
            case 0x03:
            case 0xF3:
                runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
                inI += advance.val;
                pixelA = inA[inI] | (inA[inI + 1] << 8);
                inI += 2;
                while (runLength-- > 0) {
                    wsgate.pel16(pixelA, outA, outI);
                    outI += 2;
                }
                break;
            case 0x02:
            case 0xF2:
            case 0x0D:
            case 0xF7:
                runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
                inI += advance.val;
                if (code == 0x0D || code == 0xF7) {
                    fgPel = inA[inI] | (inA[inI + 1] << 8);
                    inI += 2;
                }
                if (fFirstLine) {
                    while (runLength >= 8) {
                        bitmask = inA[inI++];
                        outI = wsgate.WriteFirstLineFgBgImage16to16(outA, outI, bitmask, fgPel, 8);
                        runLength -= 8;
                    }
                } else {
                    while (runLength >= 8) {
                        bitmask = inA[inI++];
                        outI = wsgate.WriteFgBgImage16to16(outA, outI, rowDelta, bitmask, fgPel, 8);
                        runLength -= 8;
                    }
                }
                if (runLength-- > 0) {
                    bitmask = inA[inI++];
                    if (fFirstLine) {
                        outI = wsgate.WriteFirstLineFgBgImage16to16(outA, outI, bitmask, fgPel, runLength);
                    } else {
                        outI = wsgate.WriteFgBgImage16to16(outA, outI, rowDelta, bitmask, fgPel, runLength);
                    }
                }
                break;
            case 0x04:
            case 0xF4:
                runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
                inI += advance.val;
                while (runLength-- > 0) {
                    wsgate.copy16(inA, inI, outA, outI);
                    inI += 2;
                    outI += 2;
                }
                break;
            case 0xF9:
                inI += 1;
                if (fFirstLine) {
                    outI = wsgate.WriteFirstLineFgBgImage16to16(outA, outI, 0x03, fgPel, 8);
                } else {
                    outI = wsgate.WriteFgBgImage16to16(outA, outI, rowDelta, 0x03, fgPel, 8);
                }
                break;
            case 0xFA:
                inI += 1;
                if (fFirstLine) {
                    outI = wsgate.WriteFirstLineFgBgImage16to16(outA, outI, 0x05, fgPel, 8);
                } else {
                    outI = wsgate.WriteFgBgImage16to16(outA, outI, rowDelta, 0x05, fgPel, 8);
                }
                break;
            case 0xFD:
                inI += 1;
                wsgate.pel16(0xFFFF, outA, outI);
                outI += 2;
                break;
            case 0xFE:
                inI += 1;
                wsgate.pel16(0, outA, outI);
                outI += 2;
                break;
        }
    }
}

wsgate.dRLE16_RGBA = function(inA, inLength, width, outA) {
    var runLength;
    var code, pixelA, pixelB, bitmask;
    var inI = 0;
    var outI = 0;
    var fInsertFgPel = false;
    var fFirstLine = true;
    var fgPel = 0xFFFFFF;
    var rowDelta = width * 4;
    var advance = {val: 0};

    while (inI < inLength) {
        if (fFirstLine) {
            if (outI >= rowDelta) {
                fFirstLine = false;
                fInsertFgPel = false;
            }
        }
        code = wsgate.ExtractCodeId(inA[inI]);
        if (code == 0x00 || code == 0xF0) {
            runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
            inI += advance.val;
            if (fFirstLine) {
                if (fInsertFgPel) {
                    wsgate.pel2RGBA(fgPel, outA, outI);
                    outI += 4;
                    runLength -= 1;
                }
                while (runLength > 0) {
                    wsgate.pel2RGBA(0, outA, outI);
                    runLength -= 1;
                    outI += 4;
                }
            } else {
                if (fInsertFgPel) {
                    wsgate.xorbufRGBAPel16(outA, outI - rowDelta, outA, outI, fgPel);
                    outI += 4;
                    runLength -= 1;
                }
                while (runLength > 0) {
                    wsgate.copyRGBA(outA, outI - rowDelta, outA, outI);
                    runLength -= 1;
                    outI += 4;
                }
            }
            fInsertFgPel = true;
            continue;
        }
        fInsertFgPel = false;
        switch (code) {
            case 0x01:
            case 0xF1:
            case 0x0C:
            case 0xF6:
                runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
                inI += advance.val;
                if (code == 0x0C || code == 0xF6) {
                    fgPel = inA[inI] | (inA[inI + 1] << 8);
                    inI += 2;
                }
                if (fFirstLine) {
                    while (runLength > 0) {
                        wsgate.pel2RGBA(fgPel, outA, outI);
                        runLength -= 1;
                        outI += 4;
                    }
                } else {
                    while (runLength > 0) {
                        wsgate.xorbufRGBAPel16(outA, outI - rowDelta, outA, outI, fgPel);
                        runLength -= 1;
                        outI += 4;
                    }
                }
                break;
            case 0x0E:
            case 0xF8:
                runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
                inI += advance.val;
                pixelA = inA[inI] | (inA[inI + 1] << 8);
                inI += 2;
                pixelB = inA[inI] | (inA[inI + 1] << 8);
                inI += 2;
                while (runLength > 0) {
                    wsgate.pel2RGBA(pixelA, outA, outI);
                    outI += 4;
                    wsgate.pel2RGBA(pixelB, outA, outI);
                    outI += 4;
                    runLength -= 1;
                }
                break;
            case 0x03:
            case 0xF3:
                runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
                inI += advance.val;
                pixelA = inA[inI] | (inA[inI + 1] << 8);
                inI += 2;
                while (runLength > 0) {
                    wsgate.pel2RGBA(pixelA, outA, outI);
                    outI += 4;
                    runLength -= 1;
                }
                break;
            case 0x02:
            case 0xF2:
            case 0x0D:
            case 0xF7:
                runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
                inI += advance.val;
                if (code == 0x0D || code == 0xF7) {
                    fgPel = inA[inI] | (inA[inI + 1] << 8);
                    inI += 2;
                }
                if (fFirstLine) {
                    while (runLength >= 8) {
                        bitmask = inA[inI++];
                        outI = wsgate.WriteFirstLineFgBgImage16toRGBA(outA, outI, bitmask, fgPel, 8);
                        runLength -= 8;
                    }
                } else {
                    while (runLength >= 8) {
                        bitmask = inA[inI++];
                        outI = wsgate.WriteFgBgImage16toRGBA(outA, outI, rowDelta, bitmask, fgPel, 8);
                        runLength -= 8;
                    }
                }
                if (runLength > 0) {
                    bitmask = inA[inI++];
                    if (fFirstLine) {
                        outI = wsgate.WriteFirstLineFgBgImage16toRGBA(outA, outI, bitmask, fgPel, runLength);
                    } else {
                        outI = wsgate.WriteFgBgImage16toRGBA(outA, outI, rowDelta, bitmask, fgPel, runLength);
                    }
                }
                break;
            case 0x04:
            case 0xF4:
                runLength = wsgate.ExtractRunLength(code, inA, inI, advance);
                inI += advance.val;
                while (runLength > 0) {
                    wsgate.pel2RGBA(inA[inI] | (inA[inI + 1] << 8), outA, outI);
                    inI += 2;
                    outI += 4;
                    runLength -= 1;
                }
                break;
            case 0xF9:
                inI += 1;
                if (fFirstLine) {
                    outI = wsgate.WriteFirstLineFgBgImage16toRGBA(outA, outI, 0x03, fgPel, 8);
                } else {
                    outI = wsgate.WriteFgBgImage16toRGBA(outA, outI, rowDelta, 0x03, fgPel, 8);
                }
                break;
            case 0xFA:
                inI += 1;
                if (fFirstLine) {
                    outI = wsgate.WriteFirstLineFgBgImage16toRGBA(outA, outI, 0x05, fgPel, 8);
                } else {
                    outI = wsgate.WriteFgBgImage16toRGBA(outA, outI, rowDelta, 0x05, fgPel, 8);
                }
                break;
            case 0xFD:
                inI += 1;
                wsgate.pel2RGBA(0xFFFF, outA, outI);
                outI += 4;
                break;
            case 0xFE:
                inI += 1;
                wsgate.pel2RGBA(0, outA, outI);
                outI += 4;
                break;
        }
    }
}
