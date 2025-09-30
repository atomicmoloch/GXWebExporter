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
        objects: [],        //Holds drawn objects
        currentPath: [],    //Holds yet-undrawn objects
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
 * FUNCTION:     AddMathQuillText
 *
 * DESCRIPTION:  Adds labels rendered using MathQuill DOM elements
 *
 ***********************************************************************/
    function AddMathQuillText() {
        const labels = Array.from(document.querySelectorAll(".mq-root-block"));
        for (let l of labels) {
            const position = l.getBoundingClientRect();
            const x = position.x;
            const y = position.y - (position.height * 1.5); //estimated visual offset
            state.objects.push({
                type: 1,
                text: l.innerText, //raw text of MathQuill equation
                x: x,
                y: y,
                fillStyle: "black",
            });
        }
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
            if (o.type == 0) { //Path bitflag
                const attrs = [];
                const data = o.path.join(' ');
                if (o.strokeStyle) {
                    attrs.push(`stroke="${o.strokeStyle}"`);
                    attrs.push(`stroke-width="${o.lineWidth || 1}"`);
                    attrs.push(`stroke-linejoin="${o.lineJoin}"`);
                    attrs.push(`stroke-linecap="${o.lineCap}"`);
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
            else if (o.type == 1) { //Text bitflag
                const attrs = [];
                attrs.push(`x="${o.x}"`);
                attrs.push(`y="${o.y}"`);
                attrs.push('stroke="none"');
                attrs.push(`fill="${o.fillStyle}"`);
                body += `<text ${attrs.join(' ')}>${o.text}</text>`;
            }
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
        a.download = `gxweb_export${now.toISOString()}.svg`;
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
                const origFillText = ctx.fillText

                //resets state on clearRect and sets canvas height and width
                ctx.clearRect = function(x, y, w, h) {
                    console.log("[GXWebExporter] clearRect:", x, y, w, h);
                    state.cWidth = w;
                    state.cHeight = h;
                    state.currentPath = [];
                    state.objects = [];
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
                    state.objects.push({
                        type: 0,
                        path: state.currentPath.slice(), // shallow copy
                        strokeStyle: ctx.strokeStyle, //pass by primitive (snapshots current stroke style)
                        lineWidth: ctx.lineWidth,
                        lineJoin: ctx.lineJoin,
                        lineCap: ctx.lineCap,
                        lineDash: ctx.getLineDash(), //handle later
                        fillStyle: null,
                    });
                    state.currentPath = [];
                    return origStroke.apply(this, arguments);
                };

                // Converts arc from canvas representation (center coord, radius, start and end angles, counterclockwise flag)
                // to SVG representation (radius x and y, large arc flag, sweep flag, destination x and y)
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
                        type: 0,
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

                ctx.fillText = function(text, x, y) {
                    console.log("[GXWebExporter] fillText:", text, x, y);
                    state.objects.push({
                        type: 1,
                        text: text,
                        x: x,
                        y: y,
                        fillStyle: ctx.fillStyle,
                    });
                    return origFillText.apply(this, arguments);
                }

                ctx._patched = true;
            }

            return ctx;
        };
    }

/***********************************************************************
 *
 * FUNCTION:     InitExportButton
 *
 * DESCRIPTION:  Creates export button to the right of help button on toolbar
 *
 ***********************************************************************/
    function InitExportButton() {
        if (document.getElementById('export-svg-button')) return;

        const toolbar = document.querySelector("#toolbars .toolbar.right-justified");
        const exportBtn = document.createElement('button');

        exportBtn.id = 'export-svg-button';
        exportBtn.textContent = 'Export SVG';
        exportBtn.style.height = '48px';
        exportBtn.style.padding = '0px 6px';
        exportBtn.style.boxSizing = 'border-box';
        exportBtn.style.cursor = 'pointer';
        exportBtn.style.background = '#3E9BD5';
        exportBtn.style.color = 'white';
        exportBtn.style.fontFamily = 'Lucida Sans,Lucida Sans Regular,Lucida Grande,Lucida Sans Unicode,Geneva,Verdana,sans-serif';
        exportBtn.onclick = () => {
            try {
                AddMathQuillText();
                DownloadSvg();
            } catch (err) {
                console.error('[GXWebExporter] Export failed: ', err);
                alert('Export failed: ' + err.message);
            }
        };

        toolbar.appendChild(exportBtn);
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

    // Boilerplate code to initialize after DOM is loaded
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(Init, 300);
    } else {
        window.addEventListener('DOMContentLoaded', Init);
    }

})();
