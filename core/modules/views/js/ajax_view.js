/**
 * @file
 * Handles AJAX fetching of views, including filter submission and response.
 */

(function($, Drupal, drupalSettings) {

    'use strict';

    /**
     * Attaches the AJAX behavior to exposed filters forms and key View links.
     *
     * @type {Drupal~behavior}
     *
     * @prop {Drupal~behaviorAttach} attach
     *   Attaches ajaxView functionality to relevant elements.
     */
    Drupal.behaviors.ViewsAjaxView = {};
    Drupal.behaviors.ViewsAjaxView.attach = function() {
        if (drupalSettings && drupalSettings.views && drupalSettings.views.ajaxViews) {
            var ajaxViews = drupalSettings.views.ajaxViews;
            for (var i in ajaxViews) {
                if (ajaxViews.hasOwnProperty(i)) {
                    Drupal.views.instances[i] = new Drupal.views.ajaxView(ajaxViews[i]);
                }
            }
        }
    };

    /**
     * @namespace
     */
    Drupal.views = {};

    /**
     * @type {object.<string, Drupal.views.ajaxView>}
     */
    Drupal.views.instances = {};

    /**
     * Javascript object for a certain view.
     *
     * @constructor
     *
     * @param {object} settings
     *   Settings object for the ajax view.
     * @param {string} settings.view_dom_id
     *   The DOM id of the view.
     */
    Drupal.views.ajaxView = function(settings) {
        var selector = '.js-view-dom-id-' + settings.view_dom_id;
        this.$view = $(selector);

        // Retrieve the path to use for views' ajax.
        var ajax_path = drupalSettings.views.ajax_path;

        // If there are multiple views this might've ended up showing up multiple
        // times.
        if (ajax_path.constructor.toString().indexOf('Array') !== -1) {
            ajax_path = ajax_path[0];
        }

        // Check if there are any GET parameters to send to views.
        var queryString = window.location.search || '';
        if (queryString !== '') {
            // Remove the question mark and Drupal path component if any.
            queryString = queryString.slice(1).replace(/q=[^&]+&?|&?render=[^&]+/, '');
            if (queryString !== '') {
                // If there is a '?' in ajax_path, clean url are on and & should be
                // used to add parameters.
                queryString = ((/\?/.test(ajax_path)) ? '&' : '?') + queryString;
            }
        }

        this.element_settings = {
            url: ajax_path + queryString,
            submit: settings,
            setClick: true,
            event: 'click',
            selector: selector,
            progress: {
                type: 'fullscreen'
            }
        };

        this.settings = settings;

        // Add the ajax to exposed forms.
        this.$exposed_form = $('form#views-exposed-form-' + settings.view_name.replace(/_/g, '-') + '-' + settings.view_display_id.replace(/_/g, '-'));
        this.$exposed_form.once('exposed-form').each($.proxy(this.attachExposedFormAjax, this));

        // Add the ajax to pagers.
        this.$view
            // Don't attach to nested views. Doing so would attach multiple behaviors
            // to a given element.
            .filter($.proxy(this.filterNestedViews, this))
            .once('ajax-pager').each($.proxy(this.attachPagerAjax, this));

        // Add a trigger to update this view specifically. In order to trigger a
        // refresh use the following code.
        //
        // @code
        // $('.view-name').trigger('RefreshView');
        // @endcode
        var self_settings = $.extend({}, this.element_settings, {
            event: 'RefreshView',
            base: this.selector,
            element: this.$view.get(0)
        });
        this.refreshViewAjax = Drupal.ajax(self_settings);
    };

    /**
     * @method
     */
    Drupal.views.ajaxView.prototype.attachExposedFormAjax = function() {
        var that = this;
        this.exposedFormAjax = [];
        // Exclude the reset buttons so no AJAX behaviours are bound. Many things
        // break during the form reset phase if using AJAX.
        $('input[type=submit], input[type=image]', this.$exposed_form).not('[data-drupal-selector=edit-reset]').each(function(index) {
            var self_settings = $.extend({}, that.element_settings, {
                base: $(this).attr('id'),
                element: this
            });
            that.exposedFormAjax[index] = Drupal.ajax(self_settings);
        });
    };

    /**
     * @return {bool}
     *   If there is at least one parent with a view class return false.
     *
     * @todo remove .size() replace with .length.
     */
    Drupal.views.ajaxView.prototype.filterNestedViews = function() {
        // If there is at least one parent with a view class, this view
        // is nested (e.g., an attachment). Bail.
        return !this.$view.parents('.view').size();
    };

    /**
     * Attach the ajax behavior to each link.
     */
    Drupal.views.ajaxView.prototype.attachPagerAjax = function() {
        this.$view.find('ul.js-pager__items > li > a, th.views-field a, .attachment .views-summary a')
            .each($.proxy(this.attachPagerLinkAjax, this));
    };

    /**
     * Attach the ajax behavior to a singe link.
     *
     * @param {string} [id]
     *   The ID of the link.
     * @param {HTMLElement} link
     *   The link element.
     */
    Drupal.views.ajaxView.prototype.attachPagerLinkAjax = function(id, link) {
        var $link = $(link);
        var viewData = {};
        var href = $link.attr('href');
        // Construct an object using the settings defaults and then overriding
        // with data specific to the link.
        $.extend(
            viewData,
            this.settings,
            Drupal.Views.parseQueryString(href),
            // Extract argument data from the URL.
            Drupal.Views.parseViewArgs(href, this.settings.view_base_path)
        );

        var self_settings = $.extend({}, this.element_settings, {
            submit: viewData,
            base: false,
            element: link
        });
        this.pagerAjax = Drupal.ajax(self_settings);
    };

    /**
     * Views scroll to top ajax command.
     *
     * @param {Drupal.Ajax} [ajax]
     *   A {@link Drupal.ajax} object.
     * @param {object} response
     *   Ajax response.
     * @param {string} response.selector
     *   Selector to use.
     */
    Drupal.AjaxCommands.prototype.viewsScrollTop = function(ajax, response) {
        // Scroll to the top of the view. This will allow users
        // to browse newly loaded content after e.g. clicking a pager
        // link.
        var offset = $(response.selector).offset();
        // We can't guarantee that the scrollable object should be
        // the body, as the view could be embedded in something
        // more complex such as a modal popup. Recurse up the DOM
        // and scroll the first element that has a non-zero top.
        var scrollTarget = response.selector;
        while ($(scrollTarget).scrollTop() === 0 && $(scrollTarget).parent()) {
            scrollTarget = $(scrollTarget).parent();
        }
        // Only scroll upward.
        if (offset.top - 10 < $(scrollTarget).scrollTop()) {
            $(scrollTarget).animate({
                scrollTop: (offset.top - 10)
            }, 500);
        }
    };

})(jQuery, Drupal, drupalSettings);