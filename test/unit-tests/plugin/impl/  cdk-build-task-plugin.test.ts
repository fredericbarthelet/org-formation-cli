import { CdkBuildTaskPlugin, ICdkTask } from "~plugin/impl/cdk-build-task-plugin";
import { ChildProcessUtility } from "~util/child-process-util";
import { IPluginBinding } from "~plugin/plugin-binder";
import { ICfnSubValue, ICfnGetAttValue, ICfnRefValue } from "~core/cfn-expression";
import { TemplateRoot } from "~parser/parser";
import { PersistedState } from "~state/persisted-state";
import { TestTemplates } from "../../../../test/unit-tests/test-templates";

describe('when creating cdk plugin', () => {
    let plugin: CdkBuildTaskPlugin;

    beforeEach(() => {
        plugin = new CdkBuildTaskPlugin();
    });

    test('plugin has the right type',() => {
        expect(plugin.type).toBe('cdk');
    });

    test('plugin has the right type for tasks',() => {
        expect(plugin.typeForTask).toBe('update-cdk');
    });

    test('plugin is not applied globally',() => {
        expect(plugin.applyGlobally).toBe(false);
    });

    test('plugin can translate config to command args',() => {
        const commandArgs = plugin.convertToCommandArgs( {
            FilePath: './tasks.yaml',
            Type: 'cdk',
            MaxConcurrentTasks: 6,
            FailedTaskTolerance: 4,
            LogicalName: 'test-task',
            Path: './',
            TaskRoleName: 'TaskRole',
            OrganizationBinding: { IncludeMasterAccount: true}},
            { organizationFile: './organization.yml'} as any);
        expect(commandArgs.name).toBe('test-task');
        expect(commandArgs.path).toBe('./');
        expect(commandArgs.organizationFile).toBe('./organization.yml');
        expect(commandArgs.maxConcurrent).toBe(6);
        expect(commandArgs.failedTolerance).toBe(4);
        expect(commandArgs.taskRoleName).toBe('TaskRole');
        expect(commandArgs.organizationBinding).toBeDefined();
        expect(commandArgs.organizationBinding.IncludeMasterAccount).toBe(true);
        expect(commandArgs.runNpmBuild).toBe(false);
        expect(commandArgs.runNpmInstall).toBe(false);
        expect(commandArgs.customDeployCommand).toBeUndefined();
    });

});

describe('when resolving attribute expressions on update', () => {
    let spawnProcessForAccountSpy: jest.SpyInstance;
    let binding: IPluginBinding<ICdkTask>;
    let task: ICdkTask;
    let plugin: CdkBuildTaskPlugin;
    let template: TemplateRoot;
    let state: PersistedState;

    beforeEach(() => {
        template = TestTemplates.createBasicTemplate();
        state = TestTemplates.createState(template);
        plugin = new CdkBuildTaskPlugin();
        spawnProcessForAccountSpy = jest.spyOn(ChildProcessUtility, 'SpawnProcessForAccount').mockImplementation();

        task = {
            name: 'taskName',
            type: 'cdk',
            path: './',
            runNpmBuild: false,
            runNpmInstall: false,
            hash: '123123123',
        };

        binding = {
            action: 'UpdateOrCreate',
            target: {
                targetType: 'cdk',
                logicalAccountId: 'Account',
                accountId: '1232342341235',
                region: 'eu-central-1',
                lastCommittedHash: '123123123',
                logicalName: 'taskName',
                definition: task,
            },
            task,
        };
    });

    test('spawn process is called when nothing needs to be substituted', async () => {
        await plugin.performCreateOrUpdate(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
    });

    test('custom deploy command can use CurrentTask.Parameters to get parameters', async () => {
        task.parameters = {
            param: 'val',
        }
        task.customDeployCommand = { 'Fn::Sub': 'something ${CurrentTask.Parameters} something else' } as ICfnSubValue;
        await plugin.performCreateOrUpdate(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('-c param=val'), expect.anything(), undefined, expect.anything());
    });


    test('custom deploy command can use multiple substitutions', async () => {
        task.parameters = {
            param: 'val',
        }
        task.customDeployCommand = { 'Fn::Sub': 'something ${CurrentTask.Parameters} ${CurrentAccount} something else' } as ICfnSubValue;
        await plugin.performCreateOrUpdate(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('-c param=val'), expect.anything(), undefined, expect.anything());
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining(' 1232342341235 '), expect.anything(), undefined, expect.anything());
    });

    test('parameters can use GetAtt on account', async () => {
        task.parameters = {
            key: { 'Fn::GetAtt': ['Account2', 'Tags.key'] } as ICfnGetAttValue //resolved to: Value 567
        };
        await plugin.performCreateOrUpdate(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('Value 567'), expect.anything(), undefined, expect.anything());
    });

    test('resolved parameters can will be used in custom deploy command', async () => {
        task.parameters = {
            key: { 'Fn::GetAtt': ['Account2', 'Tags.key'] } as ICfnGetAttValue //resolved to: Value 567
        };
        task.customDeployCommand = { 'Fn::Sub': 'something ${CurrentTask.Parameters}' } as ICfnSubValue;
        await plugin.performCreateOrUpdate(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('Value 567'), expect.anything(), undefined, expect.anything());
    });

    test('can resolve AWS::AccountId', async () => {
        task.parameters = {
            key: { Ref: 'AWS::AccountId' } as ICfnRefValue
        };
        await plugin.performCreateOrUpdate(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('1232342341235'), expect.anything(), undefined, expect.anything());
    });

    test('can resolve AWS::Region', async () => {
        task.parameters = {
            key: { Ref: 'AWS::Region' } as ICfnRefValue
        };
        await plugin.performCreateOrUpdate(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('eu-central-1'), expect.anything(), undefined, expect.anything());
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });
});


describe('when resolving attribute expressions on remove', () => {
    let spawnProcessForAccountSpy: jest.SpyInstance;
    let binding: IPluginBinding<ICdkTask>;
    let task: ICdkTask;
    let plugin: CdkBuildTaskPlugin;
    let template: TemplateRoot;
    let state: PersistedState;

    beforeEach(() => {
        template = TestTemplates.createBasicTemplate();
        state = TestTemplates.createState(template);
        plugin = new CdkBuildTaskPlugin();
        spawnProcessForAccountSpy = jest.spyOn(ChildProcessUtility, 'SpawnProcessForAccount').mockImplementation();

        task = {
            name: 'taskName',
            type: 'cdk',
            path: './',
            runNpmBuild: false,
            runNpmInstall: false,
            hash: '123123123',
        };

        binding = {
            action: 'UpdateOrCreate',
            target: {
                targetType: 'cdk',
                logicalAccountId: 'Account',
                accountId: '1232342341235',
                region: 'eu-central-1',
                lastCommittedHash: '123123123',
                logicalName: 'taskName',
                definition: task,
            },
            task,
        };
    });

    test('spawn process is called when nothing needs to be substituted', async () => {
        await plugin.performRemove(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
    });

    test('custom deploy command can use CurrentTask.Parameters to get parameters', async () => {
        task.parameters = {
            param: 'val',
        }
        task.customRemoveCommand = { 'Fn::Sub': 'something ${CurrentTask.Parameters} something else' } as ICfnSubValue;
        await plugin.performRemove(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('-c param=val'), expect.anything(), undefined, expect.anything());
    });


    test('custom remove command can use multiple substitutions', async () => {
        task.parameters = {
            param: 'val',
        }
        task.customRemoveCommand = { 'Fn::Sub': 'something ${CurrentTask.Parameters} ${CurrentAccount} something else' } as ICfnSubValue;
        await plugin.performRemove(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('-c param=val'), expect.anything(), undefined, expect.anything());
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining(' 1232342341235 '), expect.anything(), undefined, expect.anything());
    });

    test('parameters can use GetAtt on account', async () => {
        task.parameters = {
            key: { 'Fn::GetAtt': ['Account2', 'Tags.key'] } as ICfnGetAttValue //resolved to: Value 567
        };
        await plugin.performRemove(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('Value 567'), expect.anything(), undefined, expect.anything());
    });

    test('resolved parameters can will be used in custom deploy command', async () => {
        task.parameters = {
            key: { 'Fn::GetAtt': ['Account2', 'Tags.key'] } as ICfnGetAttValue //resolved to: Value 567
        };
        task.customRemoveCommand = { 'Fn::Sub': 'something ${CurrentTask.Parameters}' } as ICfnSubValue;
        await plugin.performRemove(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('Value 567'), expect.anything(), undefined, expect.anything());
    });

    test('can resolve AWS::AccountId', async () => {
        task.parameters = {
            key: { Ref: 'AWS::AccountId' } as ICfnRefValue
        };
        await plugin.performRemove(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('1232342341235'), expect.anything(), undefined, expect.anything());
    });

    test('can resolve AWS::Region', async () => {
        task.parameters = {
            key: { Ref: 'AWS::Region' } as ICfnRefValue
        };
        await plugin.performRemove(binding, template, state);
        expect(spawnProcessForAccountSpy).toHaveBeenCalledTimes(1);
        expect(spawnProcessForAccountSpy).lastCalledWith(expect.anything(), expect.stringContaining('eu-central-1'), expect.anything(), undefined, expect.anything());
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });
});