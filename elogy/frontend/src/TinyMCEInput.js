/*global tinymce */

/* This file originates from https://github.com/HurricaneJames/react-tinymce-input released under the MIT license */

// TinyMCE semi-controlled component.
//
// Limitations/Notes
// * `tinymce` be defined in the global scope.
// * `ignoreUpdatesWhenFocused` - sometimes TinyMCE has issues with cursor placement. This component tries very
//     hard to avoid such issues, but if the come up, this prop might help. Set it to true and the component
//     will only update the TinyMCE editor from new props when it does not have focus.
// * `onChange` - this is the main event you will want to handle. Note: unlike normal React onChange events,
//     it does not use a SyntheticEvent based event. It simply passes up the changed content.
// * events - the component listens for several events and maps them to something more React-like (ex. blur
//     => onBlur). Any event that changes the content should trigger both the original event plus onChange.
//     The event handler will receive the original tinymce event as a param.
//     [init, activate, deactivate, focus, blur, hide, remove reset, show, submit]
// * level of control - tinymce does not trigger an event on every character change. We could try binding to
//     a keyboard event. However, we have found that, in practice, getting changes in TinyMCE time is good enoug.
//     If you are trying to write a control that need per-character eventing, ex. a component that allows
//     multiple editors to work on the input at the same time, tinymce may not be right for you.

var React = require("react"),
    PropTypes = require("prop-types"),
    createReactClass = require("create-react-class"),
    uuid = require("uuid");

const DIRECT_PASSTHROUGH_EVENTS = [
    "Activate",
    "Deactivate",
    "Focus",
    "Hide",
    "Init",
    "Remove",
    "Reset",
    "Show",
    "Submit",
    "Click"
];
const PSEUDO_HIDDEN = {
    position: "absolute",
    left: -200,
    top: -200,
    height: 0
};

var TinyMCEInput = createReactClass({
    displayName: "TinyMCEInput",
    propTypes: {
        className: PropTypes.string,
        tinymceConfig: PropTypes.object.isRequired,
        name: PropTypes.string, // the form name for the input element
        value: PropTypes.string,
        rows: PropTypes.number,
        focus: PropTypes.bool, // focus the tinymce element if not already focused
        maxInitWaitTime: PropTypes.number, // [20000] maximum amount of time to wait, in ms, for tinymce to create an editor before giving up
        style: PropTypes.object,
        ignoreUpdatesWhenFocused: PropTypes.bool, // tinymce can sometimes have cursor position issues on updates, if you app does not need live updates from the backing model, then set the prop and it will only update when the editor does not have focus

        pollInterval: PropTypes.number.isRequired, // [1000] inteval to wait between polling for changes in tinymce editor (since blur does not always work), changes are then synced if the editor is focused

        // intercepted events
        onChange: PropTypes.func.isRequired, // this is a controlled component, we require onChange
        onBlur: PropTypes.func,
        onSetupEditor: PropTypes.func,

        // direct pass through events
        onActivate: PropTypes.func,
        onClick: PropTypes.func,
        onDeactivate: PropTypes.func,
        onFocus: PropTypes.func,
        onHide: PropTypes.func,
        onInit: PropTypes.func,
        onRedo: PropTypes.func,
        onRemove: PropTypes.func,
        onReset: PropTypes.func,
        onShow: PropTypes.func,
        onSubmit: PropTypes.func,
        onUndo: PropTypes.func,

        textareaProps: PropTypes.object.isRequired, // props passed through to the textarea
        otherEventHandlers: PropTypes.objectOf(PropTypes.func.isRequired)
            .isRequired
    },
    getDefaultProps: function() {
        return {
            tinymceConfig: {},
            maxInitWaitTime: 20000,
            pollInterval: 1000,
            textareaProps: {},
            otherEventHandlers: {},
            onChange: function() {},
            component: "textarea"
        };
    },
    getInitialState: function() {
        return {
            id: uuid(),
            value: this.props.value
        };
    },
    componentDidMount: function() {
        this.initStartTime = Date.now();
        if (typeof tinymce !== "undefined") {
            this.initTinyMCE();
        } else {
            this.initTimeout = setTimeout(this.initTinyMCE, 100);
        }
        this.updateInterval = setInterval(
            this.checkForChanges,
            this.props.pollInterval
        );
    },
    componentDidUpdate: function() {
        if (this.props.focus) {
            var editor = tinymce.get(this.state.id);
            if (editor) {
                editor.focus();
            }
        }
    },
    componentWillUnmount: function() {
        tinymce.remove(this.state.id);
        clearTimeout(this.initTimeout);
        clearInterval(this.updateInterval);
        this.initTimeout = undefined;
        this.initStartTime = undefined;
    },
    componentWillReceiveProps: function(nextProps) {
        if (nextProps.value !== this.state.value) {
            var editor = tinymce.get(this.state.id);
            if (editor) {
                if (
                    !this.props.ignoreUpdatesWhenFocused ||
                    tinymce.focusedEditor !== editor ||
                    this.isDropOverrideFlagged()
                ) {
                    var bookmark = editor.selection.getBookmark(2, true);
                    editor.setContent(nextProps.value);
                    editor.selection.moveToBookmark(bookmark);
                }
            }
            this.setState({ value: nextProps.value });
        }
    },
    setupPassthroughEvents: function(editor) {
        var _this = this,
            event;

        /* eslint-disable no-loop-func */
        for (var i = 0, len = DIRECT_PASSTHROUGH_EVENTS.length; i < len; ++i) {
            (function(event) {
                editor.on(event.toLowerCase(), function(tinyMCEEvent) {
                    var handler = _this.props["on" + event];
                    if (typeof handler === "function") {
                        handler(tinyMCEEvent);
                    }
                });
            })(DIRECT_PASSTHROUGH_EVENTS[i]);
        }
        /* eslint-enable no-loop-func */

        var handlers = this.props.otherEventHandlers;
        for (var eventName in handlers) {
            if (handlers.hasOwnProperty(eventName)) {
                editor.on(eventName, handlers[eventName]);
            }
        }
    },
    setupEditor: function(editor) {
        editor.on("change", this.onTinyMCEChange);
        editor.on("blur", this.onTinyMCEBlur);
        editor.on("drop", this.onTinyMCEDrop);
        editor.on("undo", this.onTinyMCEUndo);
        editor.on("redo", this.onTinyMCERedo);
        this.setupPassthroughEvents(editor);

        if (this.props.onSetupEditor) {
            this.props.onSetupEditor(editor);
        }

        if (this.props.focus) {
            editor.focus();
        }
        this.initTimeout = undefined;
    },
    createMCEContextForComponent: function() {
        var tinymceConfig = Object.assign({}, this.props.tinymceConfig, {
            selector: "#" + this.state.id,
            setup: this.setupEditor
        });
        tinymce.init(tinymceConfig);
    },
    initTinyMCE: function() {
        var currentTime = Date.now();
        if (!tinymce) {
            if (currentTime - this.initStartTime > this.props.maxInitWaitTime) {
                this.initTimeout = undefined;
            } else {
                this.initTimeout = setTimeout(this.initTinyMCE, 100);
            }
        } else {
            this.createMCEContextForComponent();
            this.initTimeout = undefined;
        }
    },
    clearDropOverride: function() {
        this._tempDropOverride = undefined;
        var editor = tinymce.get(this.state.id);
        if (editor) {
            this.syncChange(editor.getContent());
        }
    },
    flagDropOverride: function() {
        this._tempDropOverride = true;
        if (this._tempDropOverrideTimeout) {
            clearTimeout(this.clearDropOverride);
        }
        this._tempDropOverrideTimeout = setTimeout(this.clearDropOverride, 250);
    },
    isDropOverrideFlagged: function() {
        return this._tempDropOverride;
    },
    syncChange: function(newValue) {
        if (newValue !== this.state.value) {
            if (this.props.onChange) {
                this.props.onChange(newValue);
            }
            this.setState({ value: newValue });
        }
    },
    triggerEventHandler: function(handler, event) {
        if (handler) {
            handler(event);
        }
    },
    checkForChanges: function() {
        var editor = tinymce.get(this.state.id);
        if (tinymce.focusedEditor === editor) {
            var content = editor.getContent();
            if (content !== this.state.value) {
                this.syncChange(content);
            }
        }
    },
    onTinyMCEChange: function(tinyMCEEvent) {
        this.syncChange(tinyMCEEvent.target.getContent());
    },
    onTinyMCEBlur: function(tinyMCEEvent) {
        this.triggerEventHandler(this.props.onBlur, tinyMCEEvent);
        if (this.props.ignoreUpdatesWhenFocused) {
            // if we have been ignoring updates while focused (to preserve cursor position)
            // sync them now that we no longer have focus.
            tinyMCEEvent.target.setContent(this.state.value);
        }
    },
    onTinyMCEUndo: function(tinyMCEEvent) {
        this.triggerEventHandler(this.props.onUndo, tinyMCEEvent);
        this.syncChange(tinyMCEEvent.target.getContent());
    },
    onTinyMCERedo: function(tinyMCEEvent) {
        this.triggerEventHandler(this.props.onRedo, tinyMCEEvent);
        this.syncChange(tinyMCEEvent.target.getContent());
    },
    onTinyMCEDrop: function() {
        // We want to process updates just after a drop, even if processUpdatesWhenFocused
        // is false. The processUpdatesWhenFocused flag exists to keep the cursor from
        // jumping around, and we do not cares so much if the cursor jumps after dropping
        // an image because that is a mouse event. However, ignoring updates right after a
        // drop means that anything that relies on knowing the content has changed is
        // won't actually know.
        this.flagDropOverride();
    },
    onTextareaChange: function(e) {
        // should only be called when tinymce failed to load and we are getting changes directly in the textarea (fallback mode?)
        this.syncChange(e.target.value);
    },
    render: function() {
        // the textarea is controlled by tinymce... and react, neither of which agree on the value
        // solution: keep a separate input element, controlled by just react, that will actually be submitted
        const Component = this.props.component;
        return (
            <div className={this.props.className} style={this.props.style}>
                <input
                    type="hidden"
                    name={this.props.name}
                    value={this.state.value}
                    readOnly
                />
                <Component
                    id={this.state.id}
                    defaultValue={this.state.value}
                    onChange={this.onTextareaChange}
                    rows={this.props.rows}
                    style={this.props.tinymceConfig.inline ? {} : PSEUDO_HIDDEN}
                    {...this.props.textareaProps}
                />
            </div>
        );
    }
});

module.exports = TinyMCEInput;
