import {
    TEXT,
    ELEMENT,
    CLASS_COMPONENT,
    FUNC_COMPONENT,
    MOVE,
    UPDATE,
    INSERT,
    REMOVE
} from "./constants";
import { onlyOne, setProps, flatten, patchProps } from "./utils";

let updateDepth = 0; // 更新深度
let diffQueue = []; // 补丁包，记录了哪些节点需要删除，哪些需要更新, 哪些需要新建

export function ReactElement($$typeof, type, key, ref, props) {
    return {
        $$typeof,
        type,
        key,
        ref,
        props
    }
}

export function createDOM(element) {
    // 拿到第一个
    element = onlyOne(element);

    let { $$typeof, content } = element;
    let dom = null;
    // 不存在type则为文本节点
    if (!$$typeof) {
        dom = document.createTextNode(element);
    } else if ($$typeof === TEXT) {
        dom = document.createTextNode(content);
    } else if ($$typeof === ELEMENT) {
        // 是原生DOM节点
        dom = createNativeDOM(element);
    } else if ($$typeof === CLASS_COMPONENT) {
        // 类组件
        dom = createClassComponentDOM(element);
    } else if ($$typeof === FUNC_COMPONENT) {
        // 函数组件
        dom = createFunctionComponentDOM(element);
    }

    element.dom = dom;
    return dom;
}

function createNativeDOM(element) {
    let { type, props: { children }, ref } = element;
    let dom = document.createElement(type);
    // 递归构建子节点 无法中断
    // 创建子节点dom
    createDOMChildren(dom, children);

    // 更新属性
    setProps(dom, element.props);

    if (ref) {
        ref.current = dom;
    }
    return dom;
}

function createDOMChildren(parentNode, children = []) {
    flatten(children).forEach((child, index) => {
        // dom-diff 比较时专用，
        child._mountIndex = index;
        let childDOM = createDOM(child);
        parentNode.appendChild(childDOM);
    });
}

function createClassComponentDOM(element) {
    // 处理class组件

    let { type: Component, props, ref } = element;
    let componentInstance = new Component(props);

    if (Component.contextType) {
        componentInstance.context = Component.contextType.Provider.value;
    }

    // 挂载之前
    if (componentInstance.componentWillMount) {
        componentInstance.componentWillMount();
    }

    if (ref) {
        ref.current = componentInstance;
    }

    if (Component.getDerviedStateFromProps) {
        let newState = Component.getDerviedStateFromProps(props, componentInstance.state);
        if (newState) {
            componentInstance.state = { ...componentInstance.state, newState };
        }
    }

    // 类组件创建实例之后，把类组件实例挂载到虚拟DOM上
    element.componentInstance = componentInstance;

    let renderElement = componentInstance.render();
    // 类组件实例上，添加 renderElement，把老的 renderElement 保持起来，用于下一次对比
    componentInstance.renderElement = renderElement;
    let newDOM = createDOM(renderElement);

    // 把新出的DOM挂载起来
    renderElement.dom = newDOM;

    // dom生成之后
    if (componentInstance.componentDidMount) {
        componentInstance.componentDidMount();
    }
    return newDOM;
}

function createFunctionComponentDOM(element) {
    // 处理function组件 此时react15还没有hooks
    let { type, props } = element;
    let renderElement = type(props);
    let newDOM = createDOM(renderElement);
    renderElement.dom = newDOM;
    return newDOM;
}
// diff比较
export function compareTwoElement(oldRenderElement, newRenderElement) {
    oldRenderElement = onlyOne(oldRenderElement);
    newRenderElement = onlyOne(newRenderElement);

    let currentDOM = oldRenderElement.dom;
    let currentElement = oldRenderElement;
    if (newRenderElement == null) {
        // 删除
        currentDOM.parentNode.removeChild(currentDOM);
        currentDOM = null;
    } else if (oldRenderElement.type !== newRenderElement.type) {
        // 重新创建
        let newDOM = createDOM(newRenderElement);
        currentDOM.parentNode.replaceChild(newDOM, currentDOM);
        currentElement = newRenderElement;
    } else {
        // 更新
        updateElement(oldRenderElement, newRenderElement);
        currentElement = newRenderElement;
    }

    return currentElement;
}

/**
 * 新老节点一样，并且类型一样，div，span 就开始用 diff 来比较
 * @param {*} oldElement 
 * @param {*} newElement 
 */
function updateElement(oldElement, newElement) {
    // 复用旧的dom 减少重新创建的开销
    let currentDOM = newElement.dom = oldElement.dom;
    if (oldElement.$$typeof === TEXT && newElement.$$typeof === TEXT) {
        // 文本处理
        if (oldElement.content !== newElement.content) {
            currentDOM.textContent = newElement.content;
        }
    } else if (oldElement.$$typeof === ELEMENT) {
        // 原生dom元素
        updateDOMProperties(currentDOM, oldElement.props, newElement.props);
        // 更新children
        updateChildrenElements(currentDOM, oldElement.props.children, newElement.props.children);
        oldElement.props = newElement.props;
    } else if (oldElement.$$typeof === FUNC_COMPONENT) {
        updateFunctionComponent(oldElement, newElement);
    } else if (oldElement.$$typeof === CLASS_COMPONENT) {
        // 更新class组件
        updateClassComponent(oldElement, newElement);
    }
}

function updateDOMProperties(dom, oldProps, newProps) {
    patchProps(dom, oldProps, newProps);
}

function updateFunctionComponent(oldElement, newElement) {
    let oldRenderElement = oldElement.renderElement;
    // type是函数组件本身
    let newRenderElement = newElement.type(newElement.props);
    let currentElement = compareTwoElement(oldRenderElement, newRenderElement);
    newElement.renderElement = currentElement;
    return currentElement;
}

function updateClassComponent(oldElement, newElement) {
    let componentInstance = oldElement.componentInstance;
    // 复用旧的instance
    newElement.componentInstance = componentInstance;
    let oldRenderElement = componentInstance.renderElement;
    let updater = componentInstance.$updater;
    // 更改过的props
    let nextProps = newElement.props;

    // 挂载 context 处理静态的static contextType
    if(oldElement.type.contextType){
        componentInstance.context = oldElement.type.Provider.value;
    }

    let { componentWillReceiveProps } = componentInstance;
    if (componentWillReceiveProps) {
        componentWillReceiveProps();
    }
    if (newElement.type.getDerviedStateFromProps) {
        let newState = newElement.type.getDerviedStateFromProps(nextProps, componentInstance.state);
        if (newState) {
            componentInstance.state = { ...componentInstance.state, ...newState };
        }
    }
    // 触发更新
    updater.emitUpdate(nextProps);
}

function updateChildrenElements(dom, oldChildrenElements, newChildrenElements) {
    updateDepth++;
    
    diff(dom, oldChildrenElements, newChildrenElements, diffQueue);
    // diff(dom, flatten(oldChildrenElements), flatten(newChildrenElements), diffQueue);
    updateDepth--;


    // 回到定点
    if (updateDepth === 0) {
        // 回到最外面的点 开始打补丁
        // console.log(JSON.stringify(diffQueue, null, 2));
        patch(diffQueue);
        diffQueue.length = 0;
    }
}

/**
 * 1. 先更新父节点还是先更新子节点？
 * 2. 先移动父节点还是先移动子节点？
 * 
 * @param {*} parentNode 
 * @param {*} oldChildrenElements 
 * @param {*} newChildrenElements 
 */
function diff(parentNode, oldChildrenElements, newChildrenElements) {
    // 老的子节点map
    let oldChildrenElementsMap = getCildrenElementsMap(oldChildrenElements);
    // 新的子节点map
    let newChildrenElementsMap = getNewChildrenElementsMap(oldChildrenElementsMap, newChildrenElements);

    let lastIndex = 0;

    for (let i = 0; i < newChildrenElements.length; i++) {
        let newChildElement = newChildrenElements[i];
        // 当前childElement有值
        // abc 0 1 2 acb
        // lastIndex 理解为在旧的列表中目前已经比较过的最大的index
        // 若之后比较的时候遇到比这个小的可复用的旧节点 应该将它后移
        if (newChildElement) {
            // 拿到key 或者index
            let newKey = newChildrenElements[i].key || i.toString();
            // 拿到旧的child
            let oldChildElment = oldChildrenElementsMap[newKey];
            // 若是同一个
            if (newChildElement === oldChildElment) {
                // 若旧组件的位置小于当前的最后一个 表示其需要将其后移
                if (oldChildElment._mountIndex < lastIndex) {
                    diffQueue.push({
                        parentNode,
                        type: MOVE,
                        fromIndex: oldChildElment._mountIndex,
                        toIndex: i
                    })
                }
                lastIndex = Math.max(oldChildElment._mountIndex, lastIndex);
            } else {
                diffQueue.push({
                    parentNode,
                    type: INSERT,
                    dom: createDOM(newChildElement),
                    toIndex: i
                })
            }

            newChildElement._mountIndex = i;
        } else {
            // 组件卸载
            let newKey = i.toString();
            let { componentInstance } = oldChildrenElementsMap[newKey];
            if (componentInstance && componentInstance.componentWillUnmount) {
                componentInstance.componentWillUnmount();
            }
        }
    }
    
    for (const key in oldChildrenElementsMap) {
        if (!newChildrenElementsMap.hasOwnProperty(key)) {
            let oldChildElment = oldChildrenElementsMap[key];
            diffQueue.push({
                parentNode,
                type: REMOVE,
                fromIndex: oldChildElment._mountIndex
            })
        }
    }
}

function getCildrenElementsMap(oldChildrenElements) {
    let oldChildrenElementsMap = {};
    for (let i = 0; i < oldChildrenElements.length; i++) {
        let oldKey = oldChildrenElements[i].key || i.toString();
        oldChildrenElementsMap[oldKey] = oldChildrenElements[i];
    }
    return oldChildrenElementsMap
}

function getNewChildrenElementsMap(oldChildrenElementsMap, newChildrenElements) {
    let newChildrenElementsMap = {};
    for (let i = 0; i < newChildrenElements.length; i++) {
        let newChildElement = newChildrenElements[i];
        if (newChildElement) {
            let newKey = newChildrenElements[i].key || i.toString();
            let oldChildElment = oldChildrenElementsMap[newKey];
            // 可以服用，key一样，类型一样
            if (canDeepCompare(oldChildElment, newChildElement)) {
                updateElement(oldChildElment, newChildElement);
                newChildrenElements[i] = oldChildElment;
            }

            newChildrenElementsMap[newKey] = newChildrenElements[i];
        }
    }

    return newChildrenElementsMap;
}

function canDeepCompare(oldChildElment, newChildElement) {
    if (!!oldChildElment && !!newChildElement) {
        // 如果类型一样，都是相同DOM节点，就可以深度比较
        return oldChildElment.type === newChildElement.type;
    }
    return false;
}

/**
 * 1. 把需要删除和需要移动的全部删除
 * 2. 把需要移动和插入的插入进来
 * @param {*} diffQueue 
 */
function patch(diffQueue) {
    let deleteMap = {};
    let deleteChildren = [];
    for (let i = 0; i < diffQueue.length; i++) {
        // 当前变动
        let difference = diffQueue[i];
        let { parentNode, type, toIndex, fromIndex, dom } = difference;
        // 移动或者删除
        if (type === MOVE || type === REMOVE) {
            // 拿到旧的dom
            let oldChildDOM = parentNode.children[fromIndex];
            // map里面插入一个标记
            deleteMap[fromIndex] = oldChildDOM;
            deleteChildren.push(oldChildDOM);
        }
    }
    // 将deleteChildren里面的全删除
    deleteChildren.forEach(childDOM => {
        childDOM.parentNode.removeChild(childDOM);
    })

    for (let i = 0; i < diffQueue.length; i++) {
        let { parentNode, type, toIndex, fromIndex, dom } = diffQueue[i];
        switch (type) {
            case INSERT:
                insertChildAt(parentNode, dom, toIndex);
                break;
            case MOVE:
                // 插入
                insertChildAt(parentNode, deleteMap[fromIndex], toIndex);
                break;
            default:
                break;
        }
    }
}

function insertChildAt(parentNode, newChildDOM, index) {
    let oldChild = parentNode.children[index];
    if (oldChild) {
        parentNode.insertBefore(newChildDOM, oldChild)
    } else {
        parentNode.appendChild(newChildDOM);
    }
}