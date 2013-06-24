/**
 * ngc-srcset
 * http://angular-contrib.github.io/ngc-srcset
 *
 * @version 0.9.0
 * @license BSD
 */

(function(){
    'use strict';

    /**
     * @constant
     * @type {!string}
     */
    var MODULE_PREFIX = 'ngc';

    /**
     * @constant
     * @type {!string}
     */
    var MODULE_NAME = MODULE_PREFIX + 'Srcset';

    /**
     * @constant
     * @type {!string}
     */
    var DIRECTIVE_NAME = MODULE_NAME;

    /**
     * @constant
     * @type {!string}
     */
    var SRCSET_ATTRIBUTE_NAME = DIRECTIVE_NAME;

    /**
     * @constant
     * @type {!number}
     */
    var MIN_LISTENER_ID = 1000000000;

    /**
     * @constant
     * @type {!number}
     */
    var MAX_LISTENER_ID = 9999999999;

    /**
     * @constant
     * @type {!number}
     */
    var DEFAULT_MAX_PIXEL_RATIO = 1;

    /**
     * @constant
     * @type {!number}
     */
    var DEFAULT_MAX_WIDTH = Infinity;

    /**
     * @constant
     * @type {!number}
     */
    var DEFAULT_MAX_HEIGHT = DEFAULT_MAX_WIDTH;

    /**
     * @constant
     * @type {!string}
     */
    var BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

    /**
     * @name Candidate
     * @typedef {{w:!number, h:!number, x:!number, url:!string}}
     */

    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function argsToArray(argumentsObject) {
        return [].slice.call(argumentsObject, 0);
    }

    function isNonNegativeInteger(value) {
        return parseInt(value, 10) === value && value >= 0;
    }

    function isNonNegativeFloat(value) {
        return parseFloat(value) === value && value >= 0;
    }

    //noinspection JSUnresolvedVariable
    var ng = angular,
        module = ng.module(MODULE_NAME, []);

    //region Directive: ngcSrcset
    //---------------------------------------------------------------------------------------------
    //noinspection JSUnresolvedFunction
    module.directive(DIRECTIVE_NAME, srcsetDirectiveFactory);

    srcsetDirectiveFactory.$inject = ['$window', '$document', '$parse', MODULE_PREFIX + '.srcsetParser'];

    /**
     *
     * @param $window
     * @param $document
     * @param $parse
     * @param srcsetParser
     * @returns {{restrict: string, link: Function}}
     */
    function srcsetDirectiveFactory($window, $document, $parse, srcsetParser) {

        //noinspection JSUnresolvedVariable
        var pixelRatio = $window.devicePixelRatio || 1.0,
            lastWidth = getViewportWidth(),
            lastHeight = getViewportHeight(),
            resizeListeners = {};

        function getViewportHeight() {
            return $window.innerHeight || $document[0].documentElement.clientHeight;
        }

        function getViewportWidth() {
            return $window.innerWidth || $document[0].documentElement.clientWidth;
        }

        /**
         * Creates a debouncing function that executes on the trail.
         *
         * @param delay
         * @param func
         * @returns {Function}
         */
        function trailDebounce(delay, func) {
            var timeoutId;

            return function() {
                $window.clearTimeout(timeoutId);
                timeoutId = $window.setTimeout(func.apply(this, argsToArray(arguments)), delay);
            };
        }

        //noinspection JSUnresolvedFunction
        ng.element($window).bind('resize', trailDebounce(10, function() {

            var width = getViewportWidth(),
                height = getViewportHeight(),
                name;

            // Did we really get resized?
            if (width != lastWidth || height != lastHeight) {
                lastWidth = width;
                lastHeight = height;

                for (name in resizeListeners) {
                    if (resizeListeners.hasOwnProperty(name)) {
                        // XXX No need to call $apply since our listeners just set the element's src attriubute
                        resizeListeners[name]();
                    }
                }
            }
        }));

        return {
            restrict: 'ACM',

            link: function (scope, element, attributes) {

                var resizeListenerId = getRandomInt(MIN_LISTENER_ID, MAX_LISTENER_ID),
                    evaluateSrcsetExpression = $parse(attributes[SRCSET_ATTRIBUTE_NAME]),
                    originalSrc = (attributes['src'] || '').trim(),
                    candidates;

                // Debounced
                var updateSrc = trailDebounce(10, function(newSelectedCandidate) {
                    var url = newSelectedCandidate ? newSelectedCandidate.url : BLANK_IMAGE;

                    // We only change the element's src if it's really different
                    if (url != element.attr('src')) {
                        element.attr('src', url);
                    }
                });

                // Two things MAY trigger an image update:
                // 1) A change in the srcset evaluation value
                // 2) The resizing of the viewport

                // 1) Bellow we handle scope changes that might be of interest -------------------------------------

                //noinspection JSUnresolvedFunction
                scope.$watch(
                    evaluateSrcsetExpression,
                    function(newSrcset) {
                        // We need it to always be string
                        newSrcset = ((newSrcset || '') + '').trim();

                        // Valid src? Add it to the srcset to be parsed
                        if (originalSrc) {
                            newSrcset = originalSrc + ' 1x,' + newSrcset;
                        }

                        candidates = srcsetParser(newSrcset);
                        updateSrc(candidates.get(lastWidth, lastHeight, pixelRatio));
                    },
                    true
                );

                // 2) Bellow we set up to handle viewport resizing -------------------------------------------------

                // This will only actually be called if the viewport changes
                resizeListeners[resizeListenerId] = function() {
                    candidates && updateSrc(candidates.get(lastWidth, lastHeight, pixelRatio));
                };

                // We remove the listener when the element is disposed of
                element.bind('$destroy', function() {
                    if (resizeListeners.hasOwnProperty(resizeListenerId)) {
                        delete resizeListeners[resizeListenerId];
                    }
                });
            }
        };
    }
    //---------------------------------------------------------------------------------------------
    //endregion

    //region Service: srcsetParser
    //---------------------------------------------------------------------------------------------
    //noinspection JSUnresolvedFunction
    module.factory(MODULE_PREFIX + '.srcsetParser', srcsetParserFactory);

    //srcsetParserFactory.$inject = [];

    function srcsetParserFactory() {

        var whiteSpacePattern = /\s+/,
            descriptorPixelRatioPattern = /^([0-9]*\.?\d+)x$/,
            descriptorWidthPattern = /^(\d+)w$/,
            descriptorHeightPattern = /^(\d+)h$/;

        /**
         *
         * @param srcset
         * @returns {!Candidates}
         */
        function srcsetParser(srcset) {

            var candidates = [],
                rawCandidates,
                rawCandidate,
                descriptor,
                url,
                i,
                j,
                pos,
                aux;

            if (srcset != null) {
                srcset = (srcset + '').replace(whiteSpacePattern, ' ').trim();

                rawCandidates = srcset.split(',');

                candidatesLoop:
                for (i = 0; i < rawCandidates.length; i++) {
                    //noinspection JSCheckFunctionSignatures
                    rawCandidate = rawCandidates[i].trim();
                    pos = rawCandidate.indexOf(' ');

                    // Has descriptors and url?
                    if (pos > 1) {
                        url = rawCandidate.substring(0, pos).trim();
                        descriptor = _parseDescriptors(rawCandidate.substring(pos + 1));
                    }

                    // Invalid candidate?
                    if (pos < 1 || !descriptor || !url.length) {
                        continue;
                    }

                    descriptor.url = url;

                    // If there is a candidate with the same descriptors, we skip this one
                    for (j = 0; j < candidates.length; j++) {
                        aux = candidates[j];
                        if (aux.w === descriptor.w && aux.h === descriptor.h && aux.x === descriptor.x) {
                            continue candidatesLoop;
                        }
                    }

                    candidates.push(descriptor);
                }
            }

            //noinspection JSValidateTypes
            return new Candidates(candidates);

        }

        /**
         *
         * @param {!string} rawDescriptors
         * @returns {{w: !number, h: !number, x: !number}}
         * @private
         */
        function _parseDescriptors(rawDescriptors) {

            var descriptorList = (rawDescriptors + '').replace(whiteSpacePattern, ' ').split(' '),
                pixelRatio,
                width,
                height,
                match,
                i,
                item;

            for (i = 0; i < descriptorList.length; i++) {
                item = descriptorList[i];

                if (match = descriptorPixelRatioPattern.exec(item)) {
                    if (pixelRatio != null) {
                        // We've found a duplicate descriptor
                        return null;
                    }
                    pixelRatio = parseFloat(match[1]);
                }
                else if (match = descriptorWidthPattern.exec(item)) {
                    if (width != null) {
                        // We've found a duplicate descriptor
                        return null;
                    }
                    width = parseInt(match[1], 10);
                }
                else if (match = descriptorHeightPattern.exec(item)) {
                    if (height != null) {
                        // We've found a duplicate descriptor
                        return null;
                    }
                    height = parseInt(match[1], 10);
                }
                else {
                    // We've found and invalid descriptor
                    return null;
                }
            }

            // Must provide at lesat one descriptor to be valid
            if (pixelRatio == null && width == null && height == null) {
                return null;
            }

            //noinspection JSValidateTypes
            pixelRatio = pixelRatio == null ? DEFAULT_MAX_PIXEL_RATIO : pixelRatio;
            //noinspection JSValidateTypes
            width = width == null ? DEFAULT_MAX_WIDTH : width;
            //noinspection JSValidateTypes
            height = height == null ? DEFAULT_MAX_HEIGHT : height;

            return {
                w : width,
                h : height,
                x : pixelRatio
            };
        }

        /**
         *
         * @param {!Candidate[]} candidates
         * @param {!string} property
         * @param {!number} max
         * @private
         */
        function _descripotrsFilterStep1(candidates, property, max) {

            var i,
                candidate,
                maxFound = 0,
                removeIndexes = [];

            // We iterate over the candidates, finding out which ones have assossiated widths inferior to the
            // viewport and also which is the highest width among the candidates
            for (i = 0; i < candidates.length; i++) {
                candidate = candidates[i];

                if (candidate[property] < max) {
                    removeIndexes.push(i)
                }

                if (candidate[property] > maxFound) {
                    maxFound = candidate[property];
                }
            }

            // If after filtering we'd have candidates left, we filter
            if (removeIndexes.length < candidates.length) {
                for (i = removeIndexes.length - 1; i >= 0; i--) {
                    candidates.splice(removeIndexes[i], 1);
                }
            }
            // Otherwise, we reiterate filtering the ones which have assossiated widths inferior to the maximum on
            // found between them
            else {
                for (i = candidates.length - 1; i >= 0; i--) {
                    if (candidates[i][property] < maxFound) {
                        candidates.splice(i, 1);
                    }
                }
            }
        }

        /**
         *
         * @param {!Candidate[]} candidates
         * @param {!string} property
         * @private
         */
        function _descripotrsFilterStep2(candidates, property) {

            var i,
                candidate,
                minFound = Infinity;

            // We find the minimum among candidates
            for (i = 0; i < candidates.length; i++) {
                candidate = candidates[i];

                if (candidate[property] < minFound) {
                    minFound = candidate[property];
                }
            }

            // Now we remove those above the minimum
            for (i = candidates.length - 1; i >= 0; i--) {
                if (candidates[i][property] > minFound) {
                    candidates.splice(i, 1);
                }
            }
        }

        /**
         *
         * @param {Candidate[]} candidates
         */
        function Candidates(candidates) {

            /**
             *
             * @type {Candidate[]}
             * @private
             */
            this._c = candidates;
        }

        Candidates.prototype = {

            /**
             *
             * @param {number} maxWidth
             * @param {number} maxHeight
             * @param {number} maxPixelRatio
             * @returns {?Candidate}
             */
            get : function(maxWidth, maxHeight, maxPixelRatio) {

                var descriptors = ng.copy(this._c);

                if (!descriptors || !descriptors.length) {
                    return null;
                }

                // Invalid parameters
                if (!isNonNegativeInteger(maxWidth) || !isNonNegativeInteger(maxHeight) || !isNonNegativeFloat(maxPixelRatio)) {
                    throw new TypeError("First and second arguments need to be non-negative integers, and third argument need to be a non-negative float.");
                }

                _descripotrsFilterStep1(descriptors, 'w', maxWidth);
                _descripotrsFilterStep1(descriptors, 'h', maxHeight);
                _descripotrsFilterStep1(descriptors, 'x', maxPixelRatio);

                _descripotrsFilterStep2(descriptors, 'w');
                _descripotrsFilterStep2(descriptors, 'h');
                _descripotrsFilterStep2(descriptors, 'x');

                return descriptors[0];
            }
        };

        return srcsetParser;
    }
    //---------------------------------------------------------------------------------------------
    //endregion

})();
