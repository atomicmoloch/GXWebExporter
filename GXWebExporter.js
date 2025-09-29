// ==UserScript==
// @name         GXWebExporter
// @namespace    https://geometryexpressions.com
// @version      1.0
// @description  Export GXWeb constructions as SVG!
// @author       AtomicMoloch
// @match        https://geometryexpressions.com/gxweb/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

/*********************************************************************
 *  Holds state of canvas
 *********************************************************************/
    const state = {
        cWidth: 0,
        cHeight: 0,
        objects: [],
        currentPath: [],
    }

/***********************************************************************
 *
 * FUNCTION:     clean
 *
 * DESCRIPTION:  Utility function - limits precision and removes trailing zeros
 *
 ***********************************************************************/
    function clean(n) {
        return Number.parseFloat(n).toFixed(4).replace(/\.?0+$/, '');
    }


/***********************************************************************
 *
 * FUNCTION:     ConstructSvgStr
 *
 * DESCRIPTION:  Constructs SVG string from system state
 *
 ***********************************************************************/
    function ConstructSvgStr() {
        const header = `<svg xmlns="http://www.w3.org/2000/svg" width="${state.cWidth}" height="${state.cHeight}" viewBox="0 0 ${state.cWidth} ${state.cHeight}">\n`;
        let body = '';
        for (let o of state.objects) {
            const attrs = [];
            const data = o.path.join(' ');
            if (o.strokeStyle) {
                attrs.push(`stroke="${o.strokeStyle}"`);
                attrs.push(`stroke-width="${o.lineWidth || 1}"`);
                if (o.lineJoin) attrs.push(`stroke-linejoin="${o.lineJoin}"`);
                if (o.lineCap) attrs.push(`stroke-linecap="${o.lineCap}"`);
            } else {
                attrs.push('stroke="none"');
            }
            if (o.fillStyle) {
                attrs.push(`fill="${o.fillStyle}"`);
            } else {
                attrs.push('fill="none"');
            }
            body += `<path d="${data}" ${attrs.join(' ')} />\n`;
        }
        const footer = '</svg>';


        return header + body + footer;
    }


/***********************************************************************
 *
 * FUNCTION:     DownloadSvg
 *
 * DESCRIPTION:  Generates SVG file for download
 *               May be generalized if more formats added
 *
 ***********************************************************************/
    function DownloadSvg() {
        const svgStr = ConstructSvgStr();
        const now = new Date();
        const blob = new Blob([svgStr], {type: 'image/svg+xml'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        a.href = url;
        a.download = `gxweb_export${now.toString()}.svg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }


/***********************************************************************
 *
 * FUNCTION:     PatchCanvasCalls
 *
 * DESCRIPTION:  Patches display calls to the canvas so that the exporter
 *               can log what calls were made and synchronize its state.
 *
 ***********************************************************************/
    function PatchCanvasCalls() {
        const origGetContext = HTMLCanvasElement.prototype.getContext;

        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            const ctx = origGetContext.apply(this, [type, ...args]);

            if (type === "2d" && !ctx._patched) {
                // Save originals
                const origClearRect = ctx.clearRect;
                const origBeginPath = ctx.beginPath;
                const origMoveTo = ctx.moveTo;
                const origLineTo = ctx.lineTo;
                const origStroke = ctx.stroke;
                const origArc = ctx.arc;
                const origFill = ctx.fill;

                //resets state on clearRect and sets canvas height and width
                ctx.clearRect = function(x, y, w, h) {
                    console.log("[GXWebExporter] clearRect:", x, y, w, h);
                    state.cWidth = w;
                    state.cHeight = h;
                    state.currentPath = [];
                    state.path = [];
                    return origClearRect.apply(this, arguments);
                };

                //resets un-drawn path
                ctx.beginPath = function() {
                    console.log("[GXWebExporter] beginPath");
                    state.currentPath = [];
                    return origBeginPath.apply(this, arguments);
                };

                ctx.moveTo = function(x, y) {
                    console.log("[GXWebExporter] moveTo:", x, y);
                    state.currentPath.push(`M ${clean(x)} ${clean(y)}`);
                    return origMoveTo.apply(this, arguments);
                };

                ctx.lineTo = function(x, y) {
                    console.log("[GXWebExporter] lineTo:", x, y);
                    state.currentPath.push(`L ${clean(x)} ${clean(y)}`);
                    return origLineTo.apply(this, arguments);
                };

                ctx.stroke = function() {
                    console.log("[GXWebExporter] stroke");
                    if (!(ctx.strokeStyle == "#ffa500")) {
                        state.objects.push({
                        //    type: 0,
                            path: state.currentPath.slice(), // shallow copy
                            strokeStyle: ctx.strokeStyle, //pass by primitive (snapshots current stroke style)
                            lineWidth: ctx.lineWidth,
                            lineJoin: ctx.lineJoin,
                            lineCap: ctx.lineCap,
                            lineDash: ctx.getLineDash(), //handle later
                            fillStyle: null,
                        });
                    }
                    state.currentPath = [];
                    return origStroke.apply(this, arguments);
                };

                ctx.arc = function(x, y, r, startAngle, endAngle, counterclockwise) {
                    console.log("[GXWebExporter] arc:", x, y, r, startAngle, endAngle, counterclockwise);

                    const rx = x + r * Math.cos(startAngle); //radius
                    const ry = y + r * Math.sin(startAngle);
                    const dx = x + r * Math.cos(endAngle); //destination point
                    const dy = y + r * Math.sin(endAngle);

                    if (Math.abs(endAngle - startAngle) == 2 * Math.PI) {
                        const midAngle = startAngle + Math.PI;
                        const midX = x + r * Math.cos(midAngle);
                        const midY = y + r * Math.sin(midAngle);

                        if (state.currentPath.length === 0) {
                            state.currentPath.push(`M ${clean(rx)} ${clean(ry)}`);
                        }

                        state.currentPath.push(`A ${clean(r)} ${clean(r)} 0 0 ${counterclockwise ? 0 : 1} ${clean(midX)} ${clean(midY)}`);
                        state.currentPath.push(`A ${clean(r)} ${clean(r)} 0 0 ${counterclockwise ? 0 : 1} ${clean(dx)} ${clean(dy)}`);
                    // Using two arcs instead of an svg circle is a bit of a hack, but since the fill style attrs are added after
                    // arc is called, it's either this or add some messy special cases to fill
                    }
                    else {
                        let delta = endAngle - startAngle;
                        if (delta < 0 && !counterclockwise) delta += Math.PI * 2;
                        if (delta > 0 && counterclockwise) delta = Math.PI * 2 - delta;
                        const largeArcFlag = Math.abs(delta) > Math.PI ? 1 : 0;
                        const sweepFlag = counterclockwise ? 0 : 1;

                        if (state.currentPath.length === 0) {
                            state.currentPath.push(`M ${clean(rx)} ${clean(ry)}`);
                        }

                        state.currentPath.push(`A ${clean(rx)} ${clean(ry)} 0 ${largeArcFlag} ${sweepFlag} ${clean(dx)} ${clean(dy)}`);
                        //Assuming rotation always will be 0
                    }
                    return origArc.apply(this, arguments);
                };

                ctx.fill = function() {
                    console.log("[GXWebExporter] fill");
                    state.objects.push({
                    //    type: 0,
                        path: state.currentPath.slice(),
                        strokeStyle: null,
                        lineWidth: null,
                        lineJoin: null,
                        lineCap: null,
                        fillStyle: ctx.fillStyle,
                    });
                    state.currentPath = [];
                    return origFill.apply(this, arguments);
                };

                ctx._patched = true;
            }

            return ctx;
        };
    }

/***********************************************************************
 *
 * FUNCTION:     InitExportButton
 *
 * DESCRIPTION:  Creates subwindow with export button on page
 *
 ***********************************************************************/
    function InitExportButton() {
        if (document.getElementById('_gxwebexport_toolbar')) return;

        const toolbar = document.createElement('div');
        toolbar.id = '_gxweb_export_toolbar';
        toolbar.style.position = 'fixed';
        toolbar.style.bottom = '12px';
        toolbar.style.right = '12px';
        toolbar.style.zIndex = 999;

        toolbar.style.background = 'rgba(245,245,245,0.75)';
        toolbar.style.border = '1px solid rgba(136,136,136,0.75)';
        toolbar.style.borderRadius = '6px';
        toolbar.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
        toolbar.style.padding = '8px';
        toolbar.style.fontFamily = 'Lucida Sans,Lucida Sans Regular,Lucida Grande,Lucida Sans Unicode,Geneva,Verdana,sans-serif';
        toolbar.style.fontSize = '16px';
        toolbar.style.fontWeight = 'lighter';
        toolbar.style.color = '#111';

        const title = document.createElement('div');
        title.textContent = 'GXWeb Exporter';
        title.style.marginBottom = '6px';

        const exportBtn = document.createElement('button');
        exportBtn.textContent = 'Export SVG';
        exportBtn.style.padding = '6px 10px';
        exportBtn.style.border = 'none';
        exportBtn.style.borderRadius = '4px';
        exportBtn.style.cursor = 'pointer';
        exportBtn.style.background = '#3E9BD5';
        exportBtn.style.color = 'white';
        exportBtn.onclick = () => {
            try {
                DownloadSvg();
            } catch (err) {
                console.error('[GXWebExporter] Export failed: ', err);
                alert('Export failed: ' + err.message);
            }
        };

        toolbar.appendChild(title);
        toolbar.appendChild(exportBtn);
        document.body.appendChild(toolbar);
    }

/***********************************************************************
 *
 * FUNCTION:     Init
 *
 * DESCRIPTION:  Initialization routine
 *
 ***********************************************************************/
    function Init() {
        PatchCanvasCalls();
        InitExportButton();
    }

    // Initializes with a slight delay to ensure it's loaded last
    // Probably unnecessary
    setTimeout(Init, 300);

})();
